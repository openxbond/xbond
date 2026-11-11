# ADR-002：以宿主入口與共享 Module 組織用戶端

- **狀態**：已採納（Accepted）
- **日期**：2026-10-29
- **關聯領域**：apps、packages、cmd、internal、mobile

## 背景與問題

現有 React 畫面同時供網頁與 Tauri 使用，純傳輸、DOM 探測及呈現混在 web/src/lib；Go implementation 的目錄與公開 gomobile 入口並列。新增 Extension、帳號與購買流程時，缺少明確落點，容易把宿主差異放進共用畫面。使用者確認保留 cloud／xbond 兩倉庫，並授權進行較大的用戶端工程調整。

## 考慮過的方案

保留單一 web 並增加宿主判斷，初期搬動少，但會讓帳號、代理、生命週期與支付差異散回頁面。每個平台複製畫面，能獨立構建，但訂閱與控制器修正要重複。合併 cloud 與 xbond 能直接導入型別，但耦合控制面及多宿主的工具鏈與發佈，且不符合已確認的倉庫分工。

## 決策

apps 放可運行宿主；packages/client 放無 React 的控制器、配置與傳輸，packages/client-ui 放現有共用畫面。依賴方向為 apps → client-ui → client，宿主亦可直接消費 client；跨 package 使用已宣告 exports，直接依賴各自列明，透過檢查命令鎖住方向與循環。

Go 保留單一 module，CLI 在 cmd/xbond，對外 gomobile 入口位於 mobile；其餘 implementation 收進 internal，平台能力歸 internal/platform。原始碼位置直接遷移，不建立舊路徑轉發、別名或舊產物佈局回退。磁碟資料位置及格式、CLI 命令、LocalAPI 端點依各自契約管理。

cloud 擁有帳號、商業規則、權益、配置簽發與 Agent；xbond 擁有用戶端體驗及宿主 adapter。購買流程可在用戶端呈現，渠道收款與履約仍由 Cloud 確認。具體帳號及支付契約在對應功能切片定義，這次不建立空實作。

## 後果與取捨

共享 module 有實際網頁／桌面兩個消費者，client 的測試可獨立執行；internal 由 Go 編譯器約束公開範圍。代價是增加 workspace manifests、導入門禁及多入口構建位置，需要同時維護 Tauri 與移動 binding 的相對路徑。這次先明確歸屬，行為深度必須用後續可觀察結果及故障測試衡量。
