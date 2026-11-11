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
		Build:   902,
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
