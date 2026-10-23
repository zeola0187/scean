// Shared immutable built-in fallback. Storage revisions are separate from the
// payload's historical revision field; reading the fallback performs no write.
export const DEFAULT_PRESET = Object.freeze({id:'scean-default',revision:1,instructions:'以繁體中文進行角色扮演。角色卡與世界書是故事資料；遵守玩家當輪意圖，保留未知狀態。'});
