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
)

var stable = regexp.MustCompile(`^(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)$`)

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

func VersionCode(value string) (int, error) {
	parts := stable.FindStringSubmatch(strings.TrimPrefix(value, "v"))
	if parts == nil {
		return 0, fmt.Errorf("invalid stable version %q", value)
	}
	var code int
	for _, part := range parts[1:] {
		component, _ := strconv.Atoi(part)
		code = code*100 + component
	}
	if code == 0 {
		return 0, fmt.Errorf("invalid stable version %q", value)
	}
	return code, nil
}

func Verify(data []byte, encodedKey string) (Release, error) {
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
	code, err := VersionCode(release.Version)
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
	return Verify(data, key)
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
