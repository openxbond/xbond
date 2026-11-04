package mobile

import "crypto/ed25519"

// VerifyReleaseSignature verifies the exact decoded release payload with the
// app's pinned public key. Android's Ed25519 provider starts at API 33.
func VerifyReleaseSignature(payload, signature, publicKey []byte) bool {
	return len(publicKey) == ed25519.PublicKeySize &&
		ed25519.Verify(ed25519.PublicKey(publicKey), payload, signature)
}
