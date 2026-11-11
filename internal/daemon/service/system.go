package service

// The machine-scoped daemon contract shared by every platform slice: a
// privileged tunnel host that the user-session daemon delegates TUN takeover
// to. The user daemon reaches it over a platform transport that verifies the
// caller's identity (named pipe security descriptor / unix socket peer
// credentials), never over the loopback TCP LocalAPI.

// SystemListen is the fixed loopback address the machine-scoped daemon binds
// for its own LocalAPI (diagnostics; the delegation endpoints are transport
// verified and live elsewhere).
const SystemListen = "127.0.0.1:9059"
