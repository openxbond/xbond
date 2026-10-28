# 任務載體：`docs/tasks/`

本倉庫的任務記錄以檔案形式保存在 `docs/tasks/`。GitHub Issues 目前沒有使用，不要用 `gh issue create` 建立任務。

記錄結構、狀態詞彙與證據要求見[任務記錄約定](../tasks/README.md)，本文只說明 skill 該如何讀寫。

## 約定

- 一個任務一個檔案：`docs/tasks/<task-name>.md`，檔名用小寫連字符。
- 內容按 `docs/tasks/README.md` 的表格組織：範圍、切片與依賴、狀態、驗證證據、審查與探針、交付。
- 狀態只記錄能證明的階段：待核查、待規格化、待實施、進行中、待驗證、待合流、已合流。
- 分診角色寫在記錄頂部的 `分診：` 一行，見[分診詞彙](./triage-labels.md)；它與記錄自身的「狀態」欄是兩條不同的軸。
- 記錄只服務未完結的任務：合流且尾項閉環後刪除（未閉環尾項先遷入規格或另行登記）。長期行為寫進 `docs/specs/`，不往記錄裏追加歷次執行日誌；要追溯舊任務就用固定提交或 PR 連結。
- 跨里程碑的總控進度保存在 `docs/tasks/client-roadmap.md`，子任務完成後同步更新總控表。

## skill 說「發佈到任務載體」時

在 `docs/tasks/` 下新建一個任務記錄檔案。

## skill 說「取回相關任務」時

讀取對應路徑的檔案；用家通常會直接給出路徑。

## 導航（wayfinder）操作

本倉庫以 `docs/tasks/client-roadmap.md` 作為里程碑總控入口，具體實施任務對應獨立的 `docs/tasks/<task-name>.md`，阻塞關係寫在記錄的「切片與依賴」欄。
