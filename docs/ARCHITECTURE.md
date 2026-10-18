# 實際架構與資料契約（0.2.0）

Host 負責使用者權限、Studio lease／binding、run索引、取消與資料持久化。Core 僅依賴 store、model、memory ports，沒有 DSH import。正式整合以現有 ctx.llm／Typert 作 adapter，不修改 Runtime。

保存卡 handoff 固定 schemaVersion、cardId、revision、card、worldbook、preset、characters、chapterSummary、recentDialogue 和 canonical hash。新 characters 名冊必須非空、ID唯一、name及description非空。角色資料有來源時保留 source；未知背景須明示未知，不把主卡名當成角色。卡r2另開Run，舊r1不熱更新。Studio製卡Session與RPRun生命週期獨立。

PromptAssembly 包括玩家輸入、凍結sources、章節摘要、近期對話、public WorldState、公開記憶與角色{id,name}。sources內完全相同的內嵌 character_book 去掉一份，獨立worldbook保留；差異版本不合併，凍結快照不改。

Director按需 consult_character／adjudicate_action，工具循環受機械次數限制。單次CR只能指定一個已知ID，得到自身完整背景、ownState、自身及public記憶、publicWorld與本輪input；沒有另一角色的獨立私人state/memory。共享角色卡內原有資訊不被重新分類。CR結果標為 advice_not_event，不直接寫正式記憶。Stat前置可不擲骰；必要數值骰在無runner時保持未決。

Draft僅接受public assembly與Director公開brief。Prose僅接受draft、playerInput、preset。BanList以literal match定位句段；僅Prose局部修正，最多兩輪，仍命中就失敗。不新增語意Reviewer，不儲存隱藏推理。

Post-Stat以finalBody為唯一新事件來源，提出完整state和memories。state={world,characters}，角色狀態預設私人，只有明確public子物件供Director。memory={text,characterIds,visibility}；visibility為public或characters，後者至少一個已知角色。Host給每筆加id/version/source={runId,turn,commitId,bodyHash}。自由state欄位仍不能保證模型數值精度，本輪不修54/80契約。

DurableStore以每Run canonical current.json的原子rename作提交邊界，正文/state/memory/receipt同時公開。attempt檔是非權威審計。提交前失敗不發佈半輪，發佈後ack失敗依實際attempt receipt恢復。相同requestId的失敗attempt不繼承其他attempt的committed；requestOutcome可另顯示最終request成功。讀舊Run不重新驗證新名冊或自動遷移。

Memory沿用ZEOLAS0.8 Embedding+BM25+RRF，rerank可選且本次停用。先依run/角色scope篩選再檢索，移除history-evidence依賴。canonical記憶可重建index；embedding失敗明確degraded而不宣稱hybrid成功。

模型端只用既有DeepSeek Flash、既有OpenRouter/Nebius qwen3 embedding。Prose8192/其餘4096可配置，截斷不提交。UsageLedger只記請求與可得usage/cost，不設費用預留或金額攔截；舊ledger不追加。SDK未回報費用記null，不能把knownActualCostUsd當總費用。

SCEAN身份@local/dsh-scean、panel local-scean、namespace scean。隔離Studio身份@local/dsh-card-studio-scean-test、panel local-cardstudio-scean。人類operator可用SCEAN控制RPC；Studio只以有效lease選定保存卡建立run，並用綁定token只讀Inspector，不直接查私有DB。scope限制是服務授權契約，並非同Host受信插件之間的OS沙盒。
