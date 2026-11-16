// Package upgrade verifies the stable release feed and stages updates.
package upgrade

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/telemetry"
)

const (
	// CloudFeedURL serves the same signed feed through the cloud API, which
	// records the update check-in; FeedURL on GitHub Pages is the fallback
	// that keeps updates working without the cloud.
	CloudFeedURL = "https://www.xbond.net/api/clients/update/release.json"
	FeedURL      = "https://openxbond.github.io/xbond/release.json"
	DownloadURL  = "https://openxbond.github.io/xbond/download/"
	releaseRoot  = "https://github.com/openxbond/xbond/releases/download/"
	maxManifest  = 1 << 20
	maxBinary    = 512 << 20

	// ChannelStable follows the published stable release; ChannelBeta resolves
	// the newest public pre-release through the GitHub API. Candidates never
	// enter the stable feeds.
	ChannelStable = "stable"
	ChannelBeta   = "beta"

	betaIndexURL = "https://api.github.com/repos/openxbond/xbond/releases?per_page=30"
)

var (
	stable = regexp.MustCompile(`^(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)$`)
	beta   = regexp.MustCompile(`^(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)(?:-rc\.(0|[1-9][0-9]?))?$`)
)

type Release struct {
	Version string           `json:"version"`
	Build   int              `json:"build"`
	Notes   string           `json:"notes"`
	Assets  map[string]Asset `json:"assets"`
}

type Asset struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
}

type envelope struct {
	Payload   []byte `json:"payload"`
	Signature []byte `json:"signature"`
}

// BuildNumber maps a version to the shared build number. Candidates take the
// slots below 99 of their base version, so the stable release (slot 99)
// upgrades past every rc.N of the same base and still sorts below the next
// base version.
func BuildNumber(value, channel string) (int, error) {
	pattern := stable
	allowCandidate := false
	switch channel {
	case ChannelStable:
	case ChannelBeta:
		pattern, allowCandidate = beta, true
	default:
		return 0, fmt.Errorf("unknown upgrade channel %q", channel)
	}
	parts := pattern.FindStringSubmatch(strings.TrimPrefix(value, "v"))
	if parts == nil {
		return 0, fmt.Errorf("invalid %s version %q", channel, value)
	}
	var base int
	for _, part := range parts[1:4] {
		component, _ := strconv.Atoi(part)
		base = base*100 + component
	}
	slot := 99
	if allowCandidate && len(parts) > 4 && parts[4] != "" {
		candidate, _ := strconv.Atoi(parts[4])
		if candidate < 1 || candidate > 98 {
			return 0, fmt.Errorf("invalid candidate number in %q", value)
		}
		slot = candidate
	}
	if base == 0 {
		return 0, fmt.Errorf("invalid %s version %q", channel, value)
	}
	return base*100 + slot, nil
}

// VersionCode keeps the stable-channel contract used by the daemon and the
// desktop bundle, which only ever track stable versions.
func VersionCode(value string) (int, error) {
	return BuildNumber(value, ChannelStable)
}

// InstalledVersionCode reads whichever version the running binary carries,
// including a candidate build.
func InstalledVersionCode(value string) (int, error) {
	if code, err := BuildNumber(value, ChannelStable); err == nil {
		return code, nil
	}
	return BuildNumber(value, ChannelBeta)
}

func Verify(data []byte, encodedKey string) (Release, error) {
	return VerifyChannel(data, encodedKey, ChannelStable)
}

// VerifyChannel verifies a signed manifest against the channel contract. The
// stable channel rejects candidate versions so a candidate can never be
// installed through the stable feed.
func VerifyChannel(data []byte, encodedKey, channel string) (Release, error) {
	var release Release
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return release, errors.New("this build has no valid release verification key")
	}
	var signed envelope
	if err := json.Unmarshal(data, &signed); err != nil {
		return release, fmt.Errorf("decode signed release manifest: %w", err)
	}
	if !ed25519.Verify(ed25519.PublicKey(key), signed.Payload, signed.Signature) {
		return release, errors.New("invalid release manifest signature")
	}
	if err := json.Unmarshal(signed.Payload, &release); err != nil {
		return release, fmt.Errorf("decode release manifest: %w", err)
	}
	code, err := BuildNumber(release.Version, channel)
	if err != nil || strings.HasPrefix(release.Version, "v") || code != release.Build {
		return release, errors.New("inconsistent release version and build number")
	}
	return release, nil
}

func (r Release) CLI() (Asset, error) {
	target := runtime.GOOS + "-" + runtime.GOARCH
	asset, ok := r.Assets["cli-"+target]
	if !ok {
		return Asset{}, fmt.Errorf("release %s has no CLI binary for %s", r.Version, target)
	}
	expected := "xbond-v" + r.Version + "-" + target
	if runtime.GOOS == "windows" {
		expected += ".exe"
	}
	if asset.Name != expected || asset.URL != releaseRoot+"v"+r.Version+"/"+expected {
		return Asset{}, errors.New("invalid versioned CLI download URL")
	}
	digest, err := hex.DecodeString(asset.SHA256)
	if err != nil || len(digest) != sha256.Size {
		return Asset{}, errors.New("invalid CLI download checksum")
	}
	return asset, nil
}

func Fetch(ctx context.Context, key string) (Release, error) {
	return FetchChannel(ctx, key, ChannelStable)
}

// FetchChannel reads the signed manifest for the requested channel. The beta
// channel resolves the newest public pre-release through the GitHub API and
// downloads that release's own manifest; it deliberately bypasses the cloud
// feed so a candidate can never replace the stable manifest.
func FetchChannel(ctx context.Context, key, channel string) (Release, error) {
	if channel == ChannelBeta {
		return fetchBeta(ctx, key)
	}
	if channel != ChannelStable {
		return Release{}, fmt.Errorf("unknown upgrade channel %q", channel)
	}
	// The install beacon only rides the cloud attempt: GitHub Pages is a
	// third party and learns nothing about the install.
	cloudHeader := http.Header{}
	if beacon := telemetry.Header(); beacon != "" {
		cloudHeader.Set("X-XBond-Install", beacon)
	}
	body, err := get(ctx, CloudFeedURL, 30*time.Second, cloudHeader, "www.xbond.net")
	if err != nil {
		body, err = get(ctx, FeedURL, 30*time.Second, nil, "openxbond.github.io")
	}
	if err != nil {
		return Release{}, err
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, maxManifest+1))
	if err != nil {
		return Release{}, err
	}
	if len(data) > maxManifest {
		return Release{}, errors.New("release manifest exceeds size limit")
	}
	return VerifyChannel(data, key, ChannelStable)
}

type candidate struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

// latestCandidate picks the highest candidate build among the public
// pre-releases. Drafts stay invisible, and tags that do not parse as a
// candidate are ignored.
func latestCandidate(data []byte) (string, error) {
	var list []candidate
	if err := json.Unmarshal(data, &list); err != nil {
		return "", fmt.Errorf("decode candidate channel: %w", err)
	}
	best, bestCode := "", 0
	for _, entry := range list {
		if entry.Draft || !entry.Prerelease {
			continue
		}
		code, err := BuildNumber(entry.TagName, ChannelBeta)
		if err != nil {
			continue
		}
		if code > bestCode {
			best, bestCode = entry.TagName, code
		}
	}
	if best == "" {
		return "", errors.New("no published candidate is available on the beta channel")
	}
	return best, nil
}

func fetchBeta(ctx context.Context, key string) (Release, error) {
	index, err := get(ctx, betaIndexURL, 30*time.Second, nil, "api.github.com")
	if err != nil {
		return Release{}, err
	}
	data, err := io.ReadAll(io.LimitReader(index, maxManifest+1))
	index.Close()
	if err != nil {
		return Release{}, err
	}
	if len(data) > maxManifest {
		return Release{}, errors.New("candidate index exceeds size limit")
	}
	tag, err := latestCandidate(data)
	if err != nil {
		return Release{}, err
	}
	body, err := get(ctx, releaseRoot+tag+"/release.json", 30*time.Second, nil,
		"github.com", "release-assets.githubusercontent.com")
	if err != nil {
		return Release{}, err
	}
	defer body.Close()
	manifest, err := io.ReadAll(io.LimitReader(body, maxManifest+1))
	if err != nil {
		return Release{}, err
	}
	if len(manifest) > maxManifest {
		return Release{}, errors.New("release manifest exceeds size limit")
	}
	return VerifyChannel(manifest, key, ChannelBeta)
}

func (a Asset) Download(ctx context.Context, dir string) (string, error) {
	body, err := get(ctx, a.URL, 10*time.Minute, nil, "github.com", "release-assets.githubusercontent.com")
	if err != nil {
		return "", err
	}
	defer body.Close()
	return stage(dir, body, a.SHA256)
}

// Copy stages a verified bundle binary on the destination volume. The caller
// supplies a source already authenticated by the signed desktop package.
func Copy(dir, source string) (string, error) {
	file, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return stage(dir, file, "")
}

func stage(dir string, reader io.Reader, checksum string) (path string, err error) {
	pattern := ".xbond-stage-*"
	if runtime.GOOS == "windows" {
		pattern += ".exe"
	}
	file, err := os.CreateTemp(dir, pattern)
	if err != nil {
		return "", fmt.Errorf("stage update beside the installed binary: %w", err)
	}
	defer func() {
		_ = file.Close()
		if err != nil {
			_ = os.Remove(file.Name())
		}
	}()
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(reader, maxBinary+1))
	if err != nil {
		return "", err
	}
	if written == 0 || written > maxBinary {
		return "", errors.New("invalid executable size")
	}
	if checksum != "" && !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), checksum) {
		return "", errors.New("downloaded binary checksum does not match the signed manifest")
	}
	if err := file.Chmod(0o755); err != nil {
		return "", err
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	return file.Name(), nil
}

func Checksum(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	written, err := io.Copy(hash, io.LimitReader(file, maxBinary+1))
	if err != nil {
		return "", err
	}
	if written == 0 || written > maxBinary {
		return "", errors.New("invalid executable size")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func get(ctx context.Context, url string, timeout time.Duration, extra http.Header, hosts ...string) (io.ReadCloser, error) {
	allowed := func(req *http.Request) bool {
		if req.URL.Scheme != "https" || req.URL.User != nil {
			return false
		}
		for _, host := range hosts {
			if req.URL.Host == host {
				return true
			}
		}
		return false
	}
	client := &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 || !allowed(req) {
				return errors.New("unexpected release download redirect")
			}
			return nil
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if !allowed(req) {
		return nil, errors.New("unexpected release download host")
	}
	req.Header.Set("Cache-Control", "no-cache")
	for key, values := range extra {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request release download: %w", err)
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, fmt.Errorf("release server returned %s", res.Status)
	}
	return res.Body, nil
}
