# Primary sources 與可追溯範圍

本指南於 2026-10-05 依本地 v0.1.4 研究儲存的固定 source 編寫。引用證明該 snapshot 的行為，不證明使用者現在安裝的 ST／第三方 runtime 相同。以下為引用索引，正文是獨立撰寫的設計指引，不複製或打包外部 runtime。

## S1：ST 訊息管線

- SillyTavern snapshot `06bde939fb1e9c4c8d8641d810f0a916b5bce127`，package.json 顯示 1.19.0。
- [public/script.js：messageFormatting，L1771](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L1771)：regex／Markdown／DOMPurify／CSS 處理。
- [LICENSE](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/LICENSE)：AGPL-3.0；部分元件另有 attribution。

## S2：ST class 與 CSS

- [public/scripts/chats.js，L536](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/chats.js#L536)：CSS selector 字首、class 處理、media rules 與 import 過濾。
- [同檔 L1901](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/chats.js#L1901)：HTML class sanitizer hooks。

## S3：TavernHelper 前端不是原生訊息能力

- JS-Slash-Runner／TavernHelper snapshot `87ca341a2a2279f4c18cd1918c5ae9dbd1dac492`，4.11.3。
- [README，L17](https://github.com/N0VI028/JS-Slash-Runner/blob/87ca341a2a2279f4c18cd1918c5ae9dbd1dac492/README.md#L17)：第三方 JS 前端用途。
- [Iframe.vue，L1](https://github.com/N0VI028/JS-Slash-Runner/blob/87ca341a2a2279f4c18cd1918c5ae9dbd1dac492/src/panel/render/Iframe.vue#L1)：iframe 建立與無 sandbox 的該版實作。
- [iframe.ts，L78](https://github.com/N0VI028/JS-Slash-Runner/blob/87ca341a2a2279f4c18cd1918c5ae9dbd1dac492/src/panel/render/iframe.ts#L78)：document 組合與額外依賴；同檔 L6 起有 viewport 處理。
- [predefine.js，L1](https://github.com/N0VI028/JS-Slash-Runner/blob/87ca341a2a2279f4c18cd1918c5ae9dbd1dac492/src/iframe/predefine.js#L1)：parent／SillyTavern／助手／Mvu API 注入。
- [LICENSE](https://github.com/N0VI028/JS-Slash-Runner/blob/87ca341a2a2279f4c18cd1918c5ae9dbd1dac492/LICENSE)：PolyForm Noncommercial 1.0.0，不是 MIT。本指南沒有移植此程式碼。

## S4：ST regex

- [regex/engine.js，L108](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/regex/engine.js#L108)：來源與 scoped 許可。
- [同檔 L281](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/regex/engine.js#L281)：placement。
- [同檔 L334](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/regex/engine.js#L334)：disabled／depth／promptOnly／markdownOnly 等條件。
- [同檔 L391](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/regex/engine.js#L391)：RegExp／replacement／macro 處理。
- [官方 regex 檔案](https://docs.sillytavern.app/extensions/regex/) 是補充入口；網站內容未固定 commit，不凌駕固定 source。

## S5：ST 變數與 macros

- [variables.js，L22](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/variables.js#L22)：chat local 儲存；L80 起 global 儲存。
- [variable-macros.js，L10](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/macros/definitions/variable-macros.js#L10)：含寫入副作用的 macros。
- [官方 macro 檔案](https://docs.sillytavern.app/usage/core-concepts/macros/) 為補充入口。

## S6：助手 message／swipe 變數

- [variables.ts，L65](https://github.com/N0VI028/JS-Slash-Runner/blob/87ca341a2a2279f4c18cd1918c5ae9dbd1dac492/src/function/variables.ts#L65)：message、chat、global 等不同儲存；message variables 隨 swipe。
- [macro_like.ts，L96](https://github.com/N0VI028/JS-Slash-Runner/blob/87ca341a2a2279f4c18cd1918c5ae9dbd1dac492/src/function/macro_like.ts#L96)：助手 macro-like 與 scope，非通用 ST macro。

## S7：MVU（MagVarUpdate）

- Snapshot `438f9ffcba95e6c54497fa8d4223f0f48506d35a`，beta；package.json 1.0.0 不是所有部署 runtime 的版本保證。
- [variable_init.ts，L248](https://github.com/MagicalAstrogy/MagVarUpdate/blob/438f9ffcba95e6c54497fa8d4223f0f48506d35a/src/function/initvar/variable_init.ts#L248)：InitVar 載入。
- [update_variables.ts，L1647](https://github.com/MagicalAstrogy/MagVarUpdate/blob/438f9ffcba95e6c54497fa8d4223f0f48506d35a/src/function/update_variables.ts#L1647)：message 變數讀寫與重新整理。
- [variable_def.ts，L121](https://github.com/MagicalAstrogy/MagVarUpdate/blob/438f9ffcba95e6c54497fa8d4223f0f48506d35a/src/variable_def.ts#L121)：MvuData／stat_data 等。
- [global/index.ts，L13](https://github.com/MagicalAstrogy/MagVarUpdate/blob/438f9ffcba95e6c54497fa8d4223f0f48506d35a/src/function/global/index.ts#L13)：Mvu.getMvuData 用法。
- [LICENSE](https://github.com/MagicalAstrogy/MagVarUpdate/blob/438f9ffcba95e6c54497fa8d4223f0f48506d35a/LICENSE)：MIT。另 [doc/stat_var.md，L6](https://github.com/MagicalAstrogy/MagVarUpdate/blob/438f9ffcba95e6c54497fa8d4223f0f48506d35a/doc/stat_var.md#L6) 區分示範世界書素材的授權；不能把所有樣本卡視為 MIT。

## S8：ST expressions 與 adapter 差異

- [expressions/index.js，L44](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/expressions/index.js#L44)：joy fallback 與 labels。
- [同檔 L739](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/expressions/index.js#L739)：expression-set fuzzy 查詢。
- [同檔 L667](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/expressions/index.js#L667)：runtime API。引用既有能力不是本產品 adapter 已實作的證據。

## S9：隔離 iframe 標準

- [WHATWG HTML：iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)。Living Standard，非固定 snapshot；應與實際 DSH Chromium、CSP 與無害 fixture 驗證並用。不能只憑 sandbox 屬性宣稱全網路封鎖。

## 專案工具來源

13 個既有 tools 的 baseline：Card Studio v0.1.3 commit `aa57d694f4caa90cd1a31bf044aef1356df830c8` 的 `cardstudio-bundle/lib/tool-definitions.js`。新 authoring tools 以 v0.1.4 同檔與實際 session schema 為準；本指南不把研究提案當成已部署功能。


## v0.1.4 工具實作核對

本技能參數範例依同一隔離 v0.1.4 工作區下列檔案核對；它們是本版實作，不冒稱上游固定 commit 或正式已部署版本。最終工具發現與回傳仍為權威。

- `cardstudio-bundle/lib/authoring-service.js`：minimalCard 有界 canonical fields、create revision 0、frontend actions、fixture replace、visual contract actions、selected upload_id asset import／link／unlink、viewport 限制、共同 snapshot、exportBundle。
- `cardstudio-bundle/lib/frontend-authoring.js`：host-assigned component ID／locator、stable entry／regex identity、exact old_text patch、expected_source_hash、dependency analysis，不執行來源。
- `cardstudio-bundle/lib/authoring-fixture.js`：number／string／boolean／array、enum／range／display／bands、missing diagnostic，sourcePath inert；沒有 HH:mm validator。
- `cardstudio-bundle/lib/visual-state.js`：六 expression enums、characters／scene contract、patch／snapshot 與 null reset、previous／sequence、accepted=false 回退、neutral／placeholder resolver。
- `cardstudio-bundle/lib/asset-upload.js`、`asset-raster.js`：GUI token document／revision binding，PNG/JPEG/WebP 與 16 MiB 限制，raster 驗證層級。
- `cardstudio-bundle/lib/preview-projection.js`：sample／sample_label text binder、data-character-id／data-asset-id、HTML/CSS allowlist 與 CSP，卡 JS／network 關閉。
- `cardstudio-bundle/index.js`：model-facing preview receipt 去除完整 HTML／base64，以 metadata＋projection_bytes 回傳；受控 UI 取得投影。
- `cardstudio-bundle/lib/tool-definitions.js`：新工具 finalnames 及實際公開參數；`cardstudio_document` 的 export_bundle action。
