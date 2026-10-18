# CCv2 / CCv3 欄位辨識

來源：[CCv2 作者規範](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)、[CCv3 作者規範](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)。核對日期：2026-10-03。這是摘要；有歧義應回查來源。

## CCv2

外層 `spec=chara_card_v2`、`spec_version=2.0`，角色資訊在 `data`。

- 字串：`name`、`description`、`personality`、`scenario`、`first_mes`、`mes_example`、`creator_notes`、`system_prompt`、`post_history_instructions`、`creator`、`character_version`。
- 字串陣列：`alternate_greetings`、`tags`。
- 物件：`extensions`；可選 `character_book`。

Book 的必要欄位是 `extensions` 物件與 `entries` 陣列。每條 entry 必有 `keys` 字串陣列、`content` 字串、`extensions` 物件、`enabled` 布林、`insertion_order` 數字。`constant`、`selective`、`secondary_keys`、`case_sensitive`、`id`、`comment`、`priority`、`name` 與 `position` 等可選。標準 position 是 `before_char` / `after_char`。

規範要求編輯器保留未知 extensions 及已存在的可選欄位。creator notes 是作者說明；不要誤當角色設定。`{{original}}` 在提示欄位有語意，應保留。

## CCv3

外層 `spec=chara_card_v3`、`spec_version=3.0`，延續 CCv2 的 data 欄位並擴充。`group_only_greetings` 是必要字串陣列，可為空。可選欄位包括 `assets`、`nickname`、`creator_notes_multilingual`、`source`、`creation_date`、`modification_date`。

Lorebook entry 新增必要布林 `use_regex`；`id` 可為數字或字串。`constant` 的支援要求不同於 V2 的可選支援，但欄位本身仍列為可選。獨立 Lorebook V3 外層為 `spec=lorebook_v3`、`data=Lorebook`。

資產記錄含 `type`、`uri`、`name`、`ext`；保留 URI 原拼法及來源資料。CHARX 的 `embeded://` 是規範中的拼法，不能擅改成 `embedded://`。日期單位為 Unix 秒。`@@` decorators 可能影響注入，保留未知 decorators，不在製卡工作中執行它們。

本技能要求比格式最低相容性更強的保全：現有未知資料也保存於副本，除非作者明確授權移除。
