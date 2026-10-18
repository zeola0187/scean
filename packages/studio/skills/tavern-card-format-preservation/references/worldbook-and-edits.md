# 世界書與局部修改

來源：[SillyTavern 官方 World Info 文件](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)、[CCv2 CharacterBook 規範](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)。核對日期：2026-10-03。

ST UI 的藍燈表示常駐策略，綠燈表示關鍵詞策略；啟用、機率、預算、群組與其他控制仍可能影響實際注入。讀取卡片並不代表已驗證模型收到這些條目。

區分 `character_book.entries` 陣列與 ST 獨立世界書常見的 `entries` UID 字典。欄位如 `keys` / `key`、`secondary_keys` / `keysecondary`、`insertion_order` / `order` 在不同結構中可能不同。保留原結構，不以名稱近似猜轉換。

CC 標準的 `position` 字串與 ST 實作的數字位置、depth、role、遞迴、機率等擴充不是同一欄位。保留原始設定，根據指定 ST 版本核對映射後才改。

先列出 UID/ID、標題與短概要，再讀指定條目全文。作者要求改某條 `content` 時，只替換該條內容；不要一併重排、重編號、刪掉空 keys 常駐條目、改觸發或清空 description。

保留宏、HTML、EJS、regex 及 MVU 字串，將其當資料處理。未獲授權不得把它們當程式執行。資料保全檢查和實際 ST 注入測試是不同驗證階段。
