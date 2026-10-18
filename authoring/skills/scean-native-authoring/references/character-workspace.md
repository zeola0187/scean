# Character Agent v1 初始工作區

一個穩定 Character ID 對應 Snapshot 中一份固定角色設定，Run State.characters[id]，以及依該 Run／knowers 有權取得的 Memory。初始背景不偽造為已發生的回合 Memory。

1. 讀完整來源。單角色卡可由 /data/description 整理背景；多角色由明確條目、其他角色專屬字串欄位整理。不要由卡名猜測 main。
2. 選擇穩定 ID、name、description；保留背景、性格、身份、關係、行為與必要私人設定，可用既有 relationships、identity、private。description 是實際送 CR 的固定設定，不在 runtime 重新抓全本世界書。
3. `card_bind_scean_character` 參數是 document_id、expected_revision、character（上述角色物件）、sources。單卡 sources=[{kind:"card_field",path:"/data/description"}]；世界書 sources=[{kind:"worldbook_entry",entryId:10}]。entryId 使用讀回條目中的原始 id/uid（數字或字串），不是 Studio 的 "id:10" 包裝字串。同一條目混有多人時，只整理目標角色內容進 description；同一條目可分別被多人引用，不會自動注入原文。
4. 工具以新 revision upsert 該 ID，保存 sourceBindings={schemaVersion:1,characterId,descriptionHash,sources:[{kind,path或entryId,sha256}]}。hash 為 UTF-8 字串 SHA-256。世界書用精確 ID 選取，不靠陣列索引；拒絕缺失／重複 ID。card_field 只接受明確字串 JSON Pointer，不接受整個容器或 roster 自我引用。來源 hash 追蹤全文，descriptionHash 綁定整理結果。
5. card_read 讀回 character 與 sourceBindings，向作者展示選擇、歸屬理由、未定事項。作者修正以相同工具、當前 revision 更新。來源／description 改動後須重新明確綁定；舊 hash 不會偷偷刷新。
6. 人類 Bridge 建立 Snapshot 時和 Core 建 Run 時都核對來源／description hash，過期即拒絕。source.card/worldbook 的 document ID、revision、hash 與 Snapshot hash 提供版本鏈。原有未帶 bindings 的明確 roster 仍相容；新版製卡交付必須有 bindings。

本工具首版選擇目前卡片內嵌世界書。外部世界書可透過既有 handoff 與純函式契約，須先保存來源並明確綁定；工具不跨文件猜測或自動拉入外部材料。若 handoff 選擇不同世界書，綁定對不上即拒絕。

CR 每次取得本人固定設定、ownState、owner recall、publicWorld、選出的公開 worldbook、playerInput、currentEvent、characterIdentities、Director question、lastCommittedTurn。lastCommittedTurn 只含最近正式 turn/commitId/input/body，無回合時 null；屬必需上下文，容量不足沿既有 fail-closed。Memory 與公開世界書仍受原有檢索／容量選擇，不能宣稱一次送入所有記憶。

前一次問題／回覆只有 Attempt／Trace；下次不讀回這些歷史。正式正文若採納建議，依已完成正文更新 State／Memory。結構化 advice_not_event 不直接寫世界或記憶。最近正文與問題可能提到角色不知道的資訊；應維持角色正史知情差別，但沒有額外語義隔離模型。

未實作：角色 Memory 定期摘要、時間線／關係摘要、章節排程、新 Reviewer 或 RP Host 沙盒。
