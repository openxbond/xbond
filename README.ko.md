<p align="center">
  <img src="apps/dashboard/public/favicon.svg" width="96" alt="XBond" />
</p>

<h1 align="center">XBond</h1>

<p align="center">크로스 플랫폼 네트워크 프록시 클라이언트 · 데스크톱 / 모바일 / CLI / 웹 / Docker</p>

<div align="center">

[![License](https://img.shields.io/github/license/openxbond/xbond?style=flat-square)](LICENSE) [![CI](https://github.com/openxbond/xbond/actions/workflows/ci.yml/badge.svg)](https://github.com/openxbond/xbond/actions/workflows/ci.yml) [![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20iOS-525B6C?style=flat-square)](https://github.com/openxbond/xbond/releases)

</div>

[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md) | 조선어 | [فارسی](README.fa.md)

XBond는 프록시에 필요한 전 과정을 한 번에 처리합니다. 연결 설정을 가져오고, 연결을 켜고, 라우팅 전략을 고르고, 네트워크에서 벌어지는 일을 지켜볼 수 있습니다. [mihomo](https://github.com/MetaCubeX/mihomo)와 [sing-box](https://github.com/SagerNet/sing-box) 코어가 내장되어 있어 Clash YAML과 sing-box JSON 설정을 그대로 실행할 수 있고, XBond 계정이 없어도 서드파티 구독은 모든 기능을 제한 없이 쓸 수 있습니다.

## 주요 기능

- **하나의 클라이언트, 모든 플랫폼**: 데스크톱 앱(Windows 10+, macOS, Linux), 모바일 앱(Android, iOS), CLI, 웹 콘솔, Docker 이미지가 같은 기능과 도메인 개념을 공유합니다.
- **듀얼 코어 엔진**: mihomo와 sing-box가 내장되어 있고, 설정 형식에 맞는 쪽이 실행됩니다. Clash YAML과 sing-box JSON 모두 변환 없이 바로 동작합니다.
- **구독은 계정 없이도, 있으면 더 좋고**: 서드파티 구독(token, URL, 로컬 프로파일 파일)은 로그인 없이 바로 사용할 수 있습니다. XBond Cloud에 로그인하면 계정 구독과 서비스 혜택이 추가됩니다.
- **트래픽을 잡는 세 가지 방식**: 시스템 프록시, TUN, 포트 전용 — 기기 권한과 상황에 맞게 골라 쓸 수 있습니다. 일반 권한의 사용자 세션은 TUN 처리를 머신 수준 서비스에 맡길 수도 있습니다.
- **정직한 3계층 상태 표시**: 코어 도달 여부, 트래픽 처리, 외부 인터넷 연결은 별개의 사실이라 따로 표시합니다. 연결 안 됨, 불러오는 중, 실패 상태가 연결된 것처럼 보이는 일은 없습니다.
- **네트워크 활동을 한눈에**: 실시간 연결 기록, 라우팅 규칙, DNS 조회, 트래픽 통계를 제공합니다.
- **구독 히스토리**: 업데이트할 때마다 버전이 남아 이전 버전으로 되돌리거나, 특정 버전을 고정하거나, 구독별로 업데이트 경로(직접/자체 프록시)를 고를 수 있습니다.
- **제대로 된 백그라운드 서비스**: 데몬을 시스템 서비스(사용자 또는 머신 범위)로 등록해 시스템과 함께 시작할 수 있습니다. 인스턴스 락이 데이터 디렉터리별 단일 데몬을 보장하고, 종료는 안전하게 이루어집니다.
- **원격 관리**: 데스크톱·웹 UI에서 외부 코어 컨트롤러를 추가하고 제어 대상을 전환할 수 있어, 원격 프록시 인스턴스도 같은 화면에서 관리됩니다.
- **진단 기능 내장**: `doctor`는 환경과 권한을 점검하고, `bugreport`는 자격 증명을 완전히 지운 진단 번들을 만들어 줍니다.
- **업데이트와 다국어**: CLI는 `xbond upgrade`, 데스크톱은 앱 내 업데이터를 제공합니다. UI는 번체 중국어·간체 중국어·English·한국어·فارسی를 지원합니다.

## 다운로드

설치 패키지와 업데이트 매니페스트는 [다운로드 페이지](https://openxbond.github.io/xbond/download/)에, 동일한 아티팩트와 SHA256 검증값은 [GitHub Releases](https://github.com/openxbond/xbond/releases)에 있습니다.

| 플랫폼 | 형태 |
| --- | --- |
| Windows 10+ | 데스크톱 앱 (NSIS 설치 프로그램) |
| macOS | 데스크톱 앱 (DMG) |
| Linux | 데스크톱 앱 (deb / rpm / AppImage) |
| Android | 기기 아키텍처별 APK(arm64-v8a 등) + universal 패키지, VPN 방식으로 트래픽 처리 |
| iOS | TestFlight |
| CLI | Windows / macOS / Linux(amd64 / arm64) 독립 실행 파일 |
| Docker | `ghcr.io/openxbond/xbond` (amd64 / arm64) |

## 빠른 시작

### 데스크톱

1. [다운로드 페이지](https://openxbond.github.io/xbond/download/)에서 플랫폼에 맞는 데스크톱 앱을 설치해 실행합니다. 처음 실행할 때 로컬 서비스가 등록되고 시작됩니다.
2. XBond 계정에 로그인하거나 서드파티 구독을 가져옵니다.
3. 트래픽 처리 방식을 고르고 연결을 켭니다.

### CLI

```console
$ xbond daemon install             # 로컬 서비스 등록 및 시작 (--scope system은 머신 수준 서비스)
$ xbond login                      # XBond 계정 로그인 (헤드리스 환경은 --device)
$ xbond sub add <token|url|file>   # 서드파티 구독 추가
$ xbond up                         # 프록시 코어 시작
$ xbond status                     # 3계층 상태, 구독, 트래픽 확인
```

자주 쓰는 명령 모음:

| 명령 | 용도 |
| --- | --- |
| `daemon install [--scope user\|system]` · `start` · `stop` · `restart` · `status` · `uninstall` | 로컬 서비스 설치 및 관리 |
| `login [--device]` · `logout` | XBond 계정 로그인/로그아웃; `--device`는 헤드리스 환경을 위한 기기 코드 방식 |
| `sub add <token\|url\|file>` · `list` · `use` · `update` · `info` · `remove` | 서드파티 구독 추가 및 관리 |
| `sub versions` · `rollback` · `unpin` · `channel` · `edit` · `export` | 구독 버전 되돌리기, 고정, 업데이트 경로 |
| `up` · `down` · `mode [sysproxy\|tun\|port]` | 연결 켜고 끄기, 처리 방식 확인 및 전환 |
| `node list` · `select` · `test` | 정책 그룹·노드 관리, 지연 시간 측정 |
| `status` · `conns` · `rules` · `dns` · `logs` | 3계층 상태와 네트워크 활동 |
| `env` | 터미널 세션용 프록시 변수 출력 |
| `doctor` · `bugreport` | 환경 점검, 자격 증명이 지워진 진단 번들 |
| `run --config <file>` | 데몬 없이 독립 설정을 포그라운드로 실행 |
| `upgrade [--check]` · `version` · `web` | 업데이트 확인, 버전 정보, 로컬 웹 콘솔 |

### Docker

XBond Cloud 구독 페이지의 Docker 배포 명령을 복사하면 구독이 붙은 상태로 포트 또는 Linux 게이트웨이 모드로 바로 실행됩니다. 이 저장소의 Compose 예제를 써도 됩니다:

```console
$ docker compose up -d
```

`http://localhost:19090`을 열어 XBond Cloud에 로그인하거나 구독을 가져옵니다. 첫 시작 전에 `SUB_URL`을 지정하는 방법도 있습니다. 설정과 로그인 상태는 `/data` 볼륨에 저장되고, 활성 구독은 자동으로 갱신되며, 기본 mixed 프록시는 `127.0.0.1:7890`에서 대기합니다. 컨테이너 버전을 올릴 때는 `docker compose up -d --pull always`를 실행하세요.

로컬 개발에서는 `docker build -t ghcr.io/openxbond/xbond:local .`로 빌드한 뒤 `XBOND_IMAGE_TAG=local docker compose up -d --pull never`로 실행합니다. 자세한 내용은 [Docker 동작 계약](docs/specs/docker-daemon.md)을 참고하세요.

## 서버와 헤드리스 환경

데스크톱이 없는 머신에서도 XBond는 자연스럽게 동작합니다:

- **헤드리스 로그인**: `xbond login --device`는 OAuth 기기 코드 방식으로 진행되며 Docker, SSH, 헤드리스 호스트에 알맞습니다.
- **원격 관리**: 웹 콘솔은 로컬 머신을 관리하는 동시에 외부 코어 컨트롤러의 화면으로도 쓰입니다 — 데스크톱이나 웹 앱에서 원격 인스턴스 주소를 추가하면 제어 대상이 바뀝니다.
- **SSH 터널**: 원격 데몬의 관리 포트는 루프백에만 열려 있습니다. `ssh -L 19090:127.0.0.1:19090 user@host`로 로컬 브라우저에서 원격 관리 화면을 열 수 있습니다. 화면에 접근할 수 있다면 누구나 데몬을 관리할 수 있으므로, 관리 포트를 신뢰할 수 없는 네트워크에 노출하지 마세요.

이미지를 주기적으로 갱신하려면 Docker 권한이 있는 계정으로 Docker 호스트에서 예약 작업을 만들고, 경로는 Compose 파일이 있는 디렉터리로 바꾸세요:

```cron
0 4 * * * cd /path/to/xbond && docker compose up -d --pull always
```

## 계정 및 구독

XBond 클라이언트 자체는 판매 창구가 아닙니다. 로그인, 요금제, 서비스 혜택은 XBond Cloud 콘솔에서 처리하며, 로그인하지 않아도 서드파티 구독과 원격 제어는 그대로 사용할 수 있습니다.

## 문제 해결

1. `xbond status`로 3계층 상태를 하나씩 짚어 봅니다: 코어 도달 여부 → 트래픽 처리 → 외부 연결.
2. `xbond doctor`로 환경과 권한을 점검하고, 안내에 따라 처리합니다.
3. 이슈를 보고할 때는 `xbond bugreport`가 만든 진단 번들을 첨부하세요 — 자격 증명이 완전히 지워져 있어 구독 주소, 토큰, LocalAPI 자격 증명은 들어 있지 않습니다.

## 개발

이 저장소는 pnpm + Go + Rust 툴체인을 사용하며, `pnpm setup` 한 번으로 의존성을 설치합니다. 플랫폼 툴체인과 일상 명령은 다음 문서에 정리되어 있습니다:

- [개발 환경](docs/dev-env.md): 툴체인과 웹·데스크톱·모바일·CLI의 일상 진입점.
- [AGENTS.md](AGENTS.md): 저장소 구조, 개발 명령, 공통 규칙.
- [클라이언트 시스템](docs/architecture/client-system.md): 호스트, 공유 기능, 크로스 저장소 계약.
- [개발 파이프라인](docs/specs/dev-pipeline.md): 진입 라우팅, 구현, UI, 리뷰, 유지보수.
- [검증 매트릭스](docs/agents/verification.md): 변경 범위별 명령과 플랫폼 검증.
- [릴리스 매뉴얼](docs/release.md): 서명, 검증, 릴리스 절차.

UI 문자는 언어별로 [`packages/client-ui/src/i18n/messages/`](packages/client-ui/src/i18n/messages/)에, CLI 문자는 `internal/i18n/locales/`에 있습니다 — 기존 언어 개선과 새 언어 추가를 모두 환영합니다.

## 라이선스

XBond는 [GNU Affero General Public License v3](LICENSE)로 배포됩니다. 내장된 mihomo와 sing-box는 GPL-3.0 계열 라이선스를 따르며, 결합된 저작물은 GPLv3 제13조에 근거해 AGPL-3.0으로 전달됩니다. 서드파티 오픈소스 구성 요소와 라이선스는 [서드파티 고지](THIRD-PARTY-NOTICES.md)에 정리되어 있습니다.

---

이 파일은 [README.md](README.md)(번체 중국어, 기준 버전)의 번역본입니다. 내용을 바꿀 때는 기준 파일을 먼저 업데이트해 주세요.
