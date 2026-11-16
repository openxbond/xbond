package upgrade

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"runtime"
	"strings"
	"testing"
)

func TestSignedReleaseSelectsOnlyExpectedPlatformAsset(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key := base64.StdEncoding.EncodeToString(publicKey)
	target := runtime.GOOS + "-" + runtime.GOARCH
	name := "xbond-v0.9.2-" + target
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	fixture := Release{
		Version: "0.9.2",
		Build:   90299,
		Assets: map[string]Asset{
			"cli-" + target: {
				Name: name, URL: releaseRoot + "v0.9.2/" + name, SHA256: strings.Repeat("0", 64),
			},
		},
	}
	payload, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	signature := ed25519.Sign(privateKey, payload)
	signed, err := json.Marshal(envelope{Payload: payload, Signature: signature})
	if err != nil {
		t.Fatal(err)
	}
	release, err := Verify(signed, key)
	if err != nil {
		t.Fatal(err)
	}
	asset, err := release.CLI()
	if err != nil || asset.Name != name {
		t.Fatalf("CLI = %#v, %v", asset, err)
	}

	// The old signature cannot authorize a later version with changed bytes.
	changed := strings.ReplaceAll(string(payload), "0.9.2", "0.9.3")
	tampered, err := json.Marshal(envelope{Payload: []byte(changed), Signature: signature})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Verify(tampered, key); err == nil {
		t.Fatal("tampered manifest was accepted")
	}

	// Even a correctly signed metadata record must use our versioned asset URL.
	asset.URL = "https://github.com/other/repo/releases/download/v0.9.2/" + name
	release.Assets["cli-"+target] = asset
	if _, err := release.CLI(); err == nil {
		t.Fatal("unexpected download URL was accepted")
	}
}

func TestBuildNumberReservesStableSlotAboveCandidates(t *testing.T) {
	stable, err := VersionCode("1.0.0")
	if err != nil || stable != 1000099 {
		t.Fatalf("VersionCode(1.0.0) = %d, %v", stable, err)
	}
	next, err := VersionCode("1.0.1")
	if err != nil || next <= stable {
		t.Fatalf("VersionCode(1.0.1) = %d, %v; want > %d", next, err, stable)
	}
	// Candidates are not stable feed versions; they must never pass Verify.
	for _, candidate := range []string{"1.0.0-rc.1", "1.0.0.1"} {
		if _, err := VersionCode(candidate); err == nil {
			t.Fatalf("VersionCode(%q) accepted a non-stable version", candidate)
		}
	}
}

func TestStageRejectsBadChecksumWithoutLeavingFile(t *testing.T) {
	dir := t.TempDir()
	const data = "binary bytes"
	if _, err := stage(dir, strings.NewReader(data), strings.Repeat("0", 64)); err == nil {
		t.Fatal("checksum failure was ignored")
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 0 {
		t.Fatalf("invalid download remained in staging directory: %v, %v", files, err)
	}
	sum := sha256.Sum256([]byte(data))
	path, err := stage(dir, strings.NewReader(data), hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != data {
		t.Fatalf("stage = %q, %v", got, err)
	}
}

func TestUpgradeLockRejectsConcurrentWritersAndCanRetry(t *testing.T) {
	dir := t.TempDir()
	release, err := Lock(dir)
	if err != nil {
		t.Fatal(err)
	}
	if other, err := Lock(dir); err == nil {
		other()
		release()
		t.Fatal("concurrent upgrade acquired the lock")
	}
	release()
	release, err = Lock(dir)
	if err != nil {
		t.Fatal(err)
	}
	release()
}

func TestBuildNumberCoversChannels(t *testing.T) {
	cases := []struct {
		version string
		channel string
		want    int
		ok      bool
	}{
		{"1.0.0", ChannelStable, 1000099, true},
		{"1.0.0-rc.1", ChannelStable, 0, false},
		{"1.0.0-rc.1", ChannelBeta, 1000001, true},
		{"1.0.0-rc.98", ChannelBeta, 1000098, true},
		{"1.0.0", ChannelBeta, 1000099, true},
		{"1.0.0-rc.0", ChannelBeta, 0, false},
		{"1.0.0-rc.99", ChannelBeta, 0, false},
		{"1.0.0", "nightly", 0, false},
	}
	for _, test := range cases {
		code, err := BuildNumber(test.version, test.channel)
		if test.ok && (err != nil || code != test.want) {
			t.Fatalf("BuildNumber(%q, %q) = %d, %v; want %d", test.version, test.channel, code, err, test.want)
		}
		if !test.ok && err == nil {
			t.Fatalf("BuildNumber(%q, %q) accepted an invalid version", test.version, test.channel)
		}
	}
	if code, err := InstalledVersionCode("1.0.0-rc.2"); err != nil || code != 1000002 {
		t.Fatalf("InstalledVersionCode(candidate) = %d, %v", code, err)
	}
}

func TestLatestCandidatePicksHighestPublicPrerelease(t *testing.T) {
	index := []byte(`[
	  {"tag_name":"v1.0.0","draft":false,"prerelease":false},
	  {"tag_name":"v2.0.0-rc.1","draft":true,"prerelease":true},
	  {"tag_name":"v1.0.0-rc.1","draft":false,"prerelease":true},
	  {"tag_name":"v1.0.0-rc.2","draft":false,"prerelease":true},
	  {"tag_name":"nightly","draft":false,"prerelease":true}
	]`)
	tag, err := latestCandidate(index)
	if err != nil || tag != "v1.0.0-rc.2" {
		t.Fatalf("latestCandidate = %q, %v", tag, err)
	}
	if _, err := latestCandidate([]byte(`[{"tag_name":"v1.0.0","draft":false,"prerelease":false}]`)); err == nil {
		t.Fatal("a stable-only index produced a candidate")
	}
}

func TestCandidateManifestStaysOutOfTheStableChannel(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key := base64.StdEncoding.EncodeToString(publicKey)
	target := runtime.GOOS + "-" + runtime.GOARCH
	name := "xbond-v1.0.0-rc.1-" + target
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	fixture := Release{
		Version: "1.0.0-rc.1",
		Build:   1000001,
		Assets: map[string]Asset{
			"cli-" + target: {
				Name: name, URL: releaseRoot + "v1.0.0-rc.1/" + name, SHA256: strings.Repeat("0", 64),
			},
		},
	}
	payload, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	signed, err := json.Marshal(envelope{Payload: payload, Signature: ed25519.Sign(privateKey, payload)})
	if err != nil {
		t.Fatal(err)
	}
	release, err := VerifyChannel(signed, key, ChannelBeta)
	if err != nil {
		t.Fatal(err)
	}
	if asset, err := release.CLI(); err != nil || asset.Name != name {
		t.Fatalf("CLI = %#v, %v", asset, err)
	}
	if _, err := Verify(signed, key); err == nil {
		t.Fatal("the stable channel accepted a candidate manifest")
	}
	if _, err := VerifyChannel(signed, key, "nightly"); err == nil {
		t.Fatal("an unknown channel accepted a manifest")
	}
}
