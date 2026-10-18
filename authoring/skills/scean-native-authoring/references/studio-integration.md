# 真實 Card Studio 載入及寫入路徑

Card Studio Test 1.2.0-scean.2 的 index.js → prepareWorkspace → loadSkills(skillsRoot,{includeAuthoring:true,tolerantMethods:true}) → readSkill。預設 portable 模式讀插件 skills/；顯式 projectRoot 則讀工作區 .cardstudio-scean/skills/。這不是 Codex 的 .agents/skills 自動發現；agents/openai.yaml 也不是此插件的載入入口。

每個技能必須有 catalog.json 的 name/description 項及同名目錄 SKILL.md。readSkill 核對 frontmatter 名稱、references/*.md 的實檔，再回傳 content/path/resourceBase。Session acquire 經 WorkspaceLoader 身分、canonical cwd 與 lease 驗證才啟用 addon；index.js 的 skills.register 註冊非角色方法技能。Session release/dispose 撤銷。角色方法 Provider 維持原排除政策，不修改它。

完整 source checkout 使用 `python scripts/build-candidate.py`，從已提供的 canonical source 產生隔離測試副本並核對 runtime；SDK 另依 README.md 核對與抽取，不包裝到公開套件。歷史 installed-copy staging 腳本不屬於現行公開建置流程。

在已核對的 Test 工具中，新卡 cardstudio_scean_create 只能初始化敘述欄位；之後讀取 revision，再用 card_patch_fields 對 /data/extensions/scean 作局部 add/replace，保存 characters/stateBlueprint/initialState。不要覆蓋其他 extensions。Content scope 禁此修改；只有人類 UI 可切 Full，Agent 不能偽造 claim、scope 或走 filesystem 繞過。原有 target/check/repair 專為既有酒館交付，不能替代 SCEAN Core 驗證。

handoff 是 CardStudioBridge.sceanControl(mode='start') 的人類入口：選中工作副本、有效 claim、expected_revision、可選 saved worldbook revision、固定 preset，經 createSceanControl/buildSavedSnapshot 到 SceanHost.startFromStudio。Agent tool catalog 沒有此 start 工具；Skill 只產生可審查保存資料，讓作者操作既有入口。不能用工具宣稱已自動開始正式 Run。

安裝至正式版／Test 實裝是後續批准項。本輪只供隔離測試；不能把 catalog 整份蓋過既有技能。更新要先備份目標 catalog+舊技能 hash，新增／替換單項並驗證引用，再開新 Session 驗證；舊 Session 已載入內容不會自行清除。撤回僅撤這一個 catalog 項與此技能目錄，恢復精確備份，關閉該 Session；不動卡、Run、其他技能與 scope。版本不符、來源有 drift、同名但 hash 不符均停止覆蓋。

## 1.1.0 角色來源保存
使用 card_bind_scean_character 在 Full scope 建立／修正單一角色，工具計算來源 hash，詳見 [角色工作區](character-workspace.md)。原生資料仍保存在既有 extensions.scean；card_read 可檢視，原有 revision／Session／lease 規則不變。新版工具必須由整合候選提供，不是只安裝 Skill 即可使用。
