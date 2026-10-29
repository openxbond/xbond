package engine

import "time"

type TakeoverMode string

const (
	ModeSysproxy TakeoverMode = "sysproxy"
	ModeTun      TakeoverMode = "tun"
	ModePort     TakeoverMode = "port"
)

type RoutingMode string

const (
	RoutingRule   RoutingMode = "rule"
	RoutingGlobal RoutingMode = "global"
	RoutingDirect RoutingMode = "direct"
)

type EngineStatus struct {
	Running       bool         `json:"running"`
	TakeoverMode  TakeoverMode `json:"takeoverMode"`
	RoutingMode   RoutingMode  `json:"routingMode"`
	MixedPort     int          `json:"mixedPort"`
	AllowLan      bool         `json:"allowLan"`
	ClashPort     int          `json:"clashPort"`
	ClashSecret   string       `json:"clashSecret"`
	StartedAt     time.Time    `json:"startedAt"`
	UptimeSeconds int64        `json:"uptimeSeconds"`
}

type ProxyItem struct {
	Name    string         `json:"name"`
	Type    string         `json:"type"`
	UDP     bool           `json:"udp"`
	Now     string         `json:"now,omitempty"`
	History []DelayHistory `json:"history,omitempty"`
	All     []string       `json:"all,omitempty"`
}

type DelayHistory struct {
	Time  string `json:"time"`
	Delay int    `json:"delay"`
}

type ProxiesResponse struct {
	Proxies map[string]ProxyItem `json:"proxies"`
}

type ConnectionMetadata struct {
	Network     string `json:"network"`
	Type        string `json:"type"`
	SourceIP    string `json:"sourceIP"`
	Destination string `json:"destinationIP"`
	SourcePort  string `json:"sourcePort"`
	DestPort    string `json:"destinationPort"`
	Host        string `json:"host"`
	DNSMode     string `json:"dnsMode"`
	ProcessPath string `json:"processPath"`
}

type ConnectionItem struct {
	ID          string             `json:"id"`
	Metadata    ConnectionMetadata `json:"metadata"`
	Upload      int64              `json:"upload"`
	Download    int64              `json:"download"`
	Start       time.Time          `json:"start"`
	Chains      []string           `json:"chains"`
	Rule        string             `json:"rule"`
	RulePayload string             `json:"rulePayload"`
}

type ConnectionsResponse struct {
	DownloadTotal int64            `json:"downloadTotal"`
	UploadTotal   int64            `json:"uploadTotal"`
	Connections   []ConnectionItem `json:"connections"`
}

type RuleItem struct {
	Type    string `json:"type"`
	Payload string `json:"payload"`
	Proxy   string `json:"proxy"`
}

type RulesResponse struct {
	Rules []RuleItem `json:"rules"`
}

type DNSQueryResponse struct {
	Status   int      `json:"Status"`
	Question []DNSQ   `json:"Question"`
	Answer   []DNSAns `json:"Answer"`
}

type DNSQ struct {
	Name string `json:"name"`
	Type int    `json:"type"`
}

type DNSAns struct {
	Name string `json:"name"`
	Type int    `json:"type"`
	TTL  int    `json:"TTL"`
	Data string `json:"data"`
}

type DelayResponse struct {
	Delay int `json:"delay"`
}
