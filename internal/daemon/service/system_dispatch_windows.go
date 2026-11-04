//go:build windows

package service

import "golang.org/x/sys/windows/svc"

func systemInstalled() bool { return ServiceSystemInstalled() }

func systemStatus() (string, error) {
	return ServiceSystemState()
}

func uninstallSystemScope() error {
	exe, err := SelfPath()
	if err != nil {
		return err
	}
	return uninstallSystem(exe)
}

func startSystemScope(string) error {
	exe, err := SelfPath()
	if err != nil {
		return err
	}
	return SystemStart(exe)
}

func stopSystemScope(string) error {
	exe, err := SelfPath()
	if err != nil {
		return err
	}
	return SystemStop(exe)
}

// RunSystemService hosts the daemon under the service control manager. The
// run callback blocks serving the daemon and returns on stop; SCM stop and
// shutdown both close the stop channel.
func RunSystemService(listen, webDir string, run func(stop <-chan struct{}) error) error {
	return svc.Run(systemServiceName, &systemHandler{listen: listen, webDir: webDir, run: run})
}

type systemHandler struct {
	listen string
	webDir string
	run    func(stop <-chan struct{}) error
}

func (h *systemHandler) Execute(args []string, req <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	stop := make(chan struct{})
	serveErr := make(chan error, 1)
	go func() { serveErr <- h.run(stop) }()
	changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case err := <-serveErr:
			if err != nil {
				return false, 1
			}
			return false, 0
		case c := <-req:
			switch c.Cmd {
			case svc.Interrogate:
				changes <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				changes <- svc.Status{State: svc.StopPending, WaitHint: 5_000}
				close(stop)
				if err := <-serveErr; err != nil {
					return false, 1
				}
				return false, 0
			}
		}
	}
}
