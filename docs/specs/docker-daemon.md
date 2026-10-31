# 統一 Daemon Docker 鏡像

**狀態**：契約已確認；鏡像與 compose 示例已交付（`Dockerfile`、`docker-compose.yml`）。鏡像倉庫發布與 CI 歸 RELEASE-01。

## 範圍與入口

本規格定義統一 xbond daemon 官方鏡像的行為契約：完整 LocalAPI、訂閱管理、雙核心與 Web UI 以**端口模式**運行於容器。它與[既有 Docker 客戶端鏡像](https://github.com/openxbond/docker-sing-box)（獨立倉庫的 sing-box 包裝，訂閱直拉）**不能混同**：本鏡像是完整守護進程，面嚮需要 LocalAPI 管理面、Web UI 與多訂閱管理的部署；包裝鏡像面嚮「只有訂閱鏈接」的單用途網關。

## 行為契約

### 模式與環境變量

容器只支持端口模式：sysproxy 需要用戶會話、TUN 需要特權設備，兩者在容器內無意義。環境變量覆蓋守護進程偏好（env 恆勝過存儲文件；非法值**拒絕啟動**並指名變量——操作者意圖無法解析是錯誤，不是靜默默認）：

| 變量 | 鏡像缺省 | 語義 |
| --- | --- | --- |
| `XBOND_TAKEOVER_MODE` | `port` | 接管模式；`sysproxy`／`tun` 在容器內可設但無效路徑，操作者自擔 |
| `XBOND_ALLOW_LAN` | `true` | 容器內 mixed 必須綁 `0.0.0.0`（默認 `127.0.0.1` 會令端口發布失效）；宿主側收斂靠 `-p` 發布範圍 |
| `XBOND_MIXED_PORT` | `7890` | 混合代理端口 |
| `XBOND_AUTOSTART` | `1` | 守護進程啟動時若存在活躍訂閱則自動拉起核心；桌面無此環境變量，保持顯式連接 |
| `XBOND_DATA_DIR` | `/data` | 狀態目錄（卷） |

### 認證與端口作用域

LocalAPI 與 Web UI 同端口（9090）：每次啟動生成隨機訪問令牌，注入到所服務的 index.html（`localapi-token`）；瀏覽器以**同源相對路徑**調用 API——不注入地址 meta，任何能到達該監聽的主機打開頁面即可管理。因此 **9090 的發布範圍就是管理邊界**：默認發布到 `127.0.0.1`，需要局域網管理時由操作者顯式放寬。LocalAPI 本身要求 `X-XBond-Token`。7890 是代理入站，發布範圍按需。

### 生命週期與驗收

- 健康檢查探測 9090（守護進程活性，不等於核心運行；核心狀態經 UI/status 判讀）。
- `docker restart`／宿主重啟後：訂閱、偏好與活躍選擇從 `/data` 卷恢復，`XBOND_AUTOSTART` 拉起核心。
- `docker stop` → SIGTERM → 核心停止、監聽釋放、鎖釋放，退出碼 0。
- 升級 = 換鏡像標籤重建容器（卷保留）；版本與標籤策略歸 RELEASE-01。

## 驗收條件（2026-10-31 實測，Docker 29.8.0/linux-amd64）

| 編號 | 結果 | 實際檢查 |
| --- | --- | --- |
| DIMG-01 | 鏡像構建成功，雙階段（pnpm web dist + Go 雙核心同標籤） | `docker build` 通過；運行時 alpine 3.21 + 非根用戶 |
| DIMG-02 | env 覆蓋生效且非法值拒絕啟動 | `internal/daemon/state_test.go`（env 勝存儲、非法指名變量）；容器實測 takeover=port、allowLan=true、mixed=7890 |
| DIMG-03 | 認證：令牌注入服務頁、LocalAPI 驗令牌、同源無地址 meta | 容器實測：index 含 token、無 `localapi-addr`；無令牌請求 401 路徑由既有測試覆蓋 |
| DIMG-04 | 導入→激活→up→發布端口真實代理響應 | 發布 17890 探針返回 mihomo `HTTP/1.1 400 Bad Request` |
| DIMG-05 | 重啟持久化 + 自啟 | `docker restart` 後 running=true（clash 核心）、活躍訂閱保留、探針復通 |
| DIMG-06 | 優雅停止 | `docker stop` 退出碼 0，日誌「Mihomo shutting down」 |
| DIMG-07 | 體積評估 | **150 MB**（雙核心二進制約 135 MB 為主體；`-s -w` + alpine 基底）。後續可選 slim 變體（去掉 `with_gvisor`，端口模式無需 TUN 棧）再省約 30-40 MB，屬 RELEASE-01 決策 |

## 已知限制

容器內無 sysproxy/TUN 路徑；GEOIP/GEOSITE 首次下載需容器出網。9090 的頁面注入令牌模型意味著「能打開頁面即能管理」——TLS 與額外認證屬部署側（反代）職責，本契約以發布範圍為邊界。鏡像倉庫發布、多架構構建與標籤策略未實施（RELEASE-01）。健康檢查不含核心狀態。
