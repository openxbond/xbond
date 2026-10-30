package account

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/openxbond/xbond/internal/clientapi"
	"golang.org/x/oauth2"
)

const loginTimeout = 5 * time.Minute

// Authenticate runs the Better Auth OAuth flow. PKCE through the system
// browser is the default; device authorization is the explicit headless path
// and also the fallback when no loopback listener can be opened.
func Authenticate(
	ctx context.Context,
	opts LoginOptions,
	progress func(Progress),
) (*oauth2.Token, error) {
	origin, err := NormalizeOrigin(opts.Origin)
	if err != nil {
		return nil, err
	}
	conf := clientapi.NewConfig(origin)

	if opts.Device {
		return deviceLogin(ctx, conf, opts, progress)
	}
	token, err := pkceLogin(ctx, conf, opts, progress)
	if err == nil {
		return token, nil
	}
	var listenErr *listenError
	if errors.As(err, &listenErr) {
		return deviceLogin(ctx, conf, opts, progress)
	}
	return nil, err
}

type listenError struct{ err error }

func (e *listenError) Error() string { return e.err.Error() }
func (e *listenError) Unwrap() error { return e.err }

func pkceLogin(
	ctx context.Context,
	conf *oauth2.Config,
	opts LoginOptions,
	progress func(Progress),
) (*oauth2.Token, error) {
	verifier := oauth2.GenerateVerifier()
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		return nil, fmt.Errorf("generate oauth state: %w", err)
	}
	state := hex.EncodeToString(stateBytes)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, &listenError{err: err}
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)
	authURL := conf.AuthCodeURL(
		state,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("redirect_uri", redirectURI),
		clientapi.ResourceOption(),
	)
	reportProgress(progress, Progress{Method: "pkce", AuthURL: authURL})
	openBrowser(opts, authURL)

	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if code := r.URL.Query().Get("error"); code != "" {
			description := r.URL.Query().Get("error_description")
			http.Error(w, "OAuth error: "+code, http.StatusBadRequest)
			select {
			case errCh <- &Error{Code: code, Err: errors.New(description)}:
			default:
			}
			return
		}
		if r.URL.Query().Get("state") != state {
			http.Error(w, "invalid state", http.StatusBadRequest)
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "missing authorization code", http.StatusBadRequest)
			return
		}

		page := defaultCallbackHTML
		if opts.CallbackHTML != nil {
			page = opts.CallbackHTML(r.URL.Query().Get("lang"))
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(page))
		select {
		case codeCh <- code:
		default:
		}
	})

	server := &http.Server{Handler: mux}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			select {
			case errCh <- err:
			default:
			}
		}
	}()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	var code string
	select {
	case code = <-codeCh:
	case err := <-errCh:
		return nil, err
	case <-time.After(loginTimeout):
		return nil, &Error{Code: ErrCodeTimeout, Err: errors.New("login timed out")}
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	token, err := conf.Exchange(
		ctx,
		code,
		oauth2.VerifierOption(verifier),
		oauth2.SetAuthURLParam("redirect_uri", redirectURI),
		clientapi.ResourceOption(),
	)
	if err != nil {
		return nil, mapOAuthError(err)
	}
	return token, nil
}

func deviceLogin(
	ctx context.Context,
	conf *oauth2.Config,
	opts LoginOptions,
	progress func(Progress),
) (*oauth2.Token, error) {
	device, err := conf.DeviceAuth(ctx, clientapi.ResourceOption())
	if err != nil {
		return nil, mapOAuthError(err)
	}
	reportProgress(progress, Progress{
		Method:                  "device",
		VerificationURI:         device.VerificationURI,
		VerificationURIComplete: device.VerificationURIComplete,
		UserCode:                device.UserCode,
		ExpiresIn:               int(device.Expiry.Sub(time.Now()).Seconds()),
		Interval:                int(device.Interval),
	})
	if device.VerificationURIComplete != "" {
		openBrowser(opts, device.VerificationURIComplete)
	} else {
		openBrowser(opts, device.VerificationURI)
	}

	token, err := conf.DeviceAccessToken(ctx, device, clientapi.ResourceOption())
	if err != nil {
		return nil, mapOAuthError(err)
	}
	return token, nil
}

func reportProgress(progress func(Progress), value Progress) {
	if progress != nil {
		progress(value)
	}
}

func openBrowser(opts LoginOptions, target string) {
	if opts.NoBrowser || opts.OpenBrowser == nil || target == "" {
		return
	}
	_ = opts.OpenBrowser(target)
}

func mapOAuthError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return &Error{Code: ErrCodeTimeout, Err: err}
	}
	var retrieveErr *oauth2.RetrieveError
	if errors.As(err, &retrieveErr) {
		switch retrieveErr.ErrorCode {
		case "access_denied":
			return &Error{Code: ErrCodeAccessDenied, Err: err}
		case "expired_token":
			return &Error{Code: ErrCodeExpired, Err: err}
		}
	}
	return &Error{Code: ErrCodeOAuth, Err: err}
}

const defaultCallbackHTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>XBond login</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem;">
<h1>Login complete</h1>
<p>You can close this tab and return to XBond.</p>
</body>
</html>`
