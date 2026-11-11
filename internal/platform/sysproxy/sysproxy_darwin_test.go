//go:build darwin

package sysproxy

import "testing"

func TestPickDefaultNetworkService(t *testing.T) {
	cases := []struct {
		name    string
		order   string
		want    string
		wantErr bool
	}{
		{
			name: "pairs service names with their port lines",
			order: `An asterisk (*) denotes that a network service is disabled.
(1) Built-in Serial Port (1)
(Hardware Port: Built-in Serial Port (1), Device: serial1)

(2) Ethernet
(Hardware Port: Ethernet, Device: en0)
`,
			want: "Ethernet",
		},
		{
			name: "prefers Wi-Fi when listed first",
			order: `An asterisk (*) denotes that a network service is disabled.
(1) Wi-Fi
(Hardware Port: Wi-Fi, Device: en0)

(2) Ethernet
(Hardware Port: Ethernet, Device: en1)
`,
			want: "Wi-Fi",
		},
		{
			name: "localised labels with full-width punctuation",
			order: `星号 (*) 表示网络服务已停用。
（1）Wi-Fi
（硬件端口：Wi-Fi，设备：en0）

（2）Ethernet
（硬件端口：Ethernet，设备：en1）
`,
			want: "Wi-Fi",
		},
		{
			name: "skips disabled services",
			order: `An asterisk (*) denotes that a network service is disabled.
(1) Thunderbolt Ethernet (*)
(Hardware Port: Thunderbolt Ethernet, Device: en1)

(2) Ethernet
(Hardware Port: Ethernet, Device: en0)
`,
			want: "Ethernet",
		},
		{
			name: "errors when no Wi-Fi or Ethernet service exists",
			order: `An asterisk (*) denotes that a network service is disabled.
(1) Built-in Serial Port (1)
(Hardware Port: Built-in Serial Port (1), Device: serial1)
`,
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			service, err := pickDefaultNetworkService(tc.order)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got service %q", service)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if service != tc.want {
				t.Fatalf("service = %q, want %q", service, tc.want)
			}
		})
	}
}
