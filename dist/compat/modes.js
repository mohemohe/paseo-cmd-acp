import { isRecord } from "../json-rpc.js";
const MODE_CONFIG_ID = "mode";
/**
 * Command Code はモードを `modes` で返し、configOptions には model / effort しか入れない。
 * Paseo は config_option_update を受けるとモード一覧を configOptions から作り直すため、
 * モデルや effort を変えた直後からモードが空になり切り替えられなくなる。
 * そこで configOptions に mode カテゴリの select を補う。
 */
export class ModeCompat {
    sessions = new Map();
    /** session/new・load・resume の結果からモードを記録し、configOptions に補う。 */
    applySessionResult(sessionId, result) {
        const modes = parseModeState(result.modes);
        if (modes) {
            this.sessions.set(sessionId, modes);
        }
        if (!Array.isArray(result.configOptions)) {
            return result;
        }
        return { ...result, configOptions: this.withModeOption(sessionId, result.configOptions) };
    }
    setCurrentMode(sessionId, modeId) {
        const state = this.sessions.get(sessionId);
        if (state) {
            state.currentModeId = modeId;
        }
    }
    withModeOption(sessionId, configOptions) {
        const state = this.sessions.get(sessionId);
        if (!state || state.availableModes.length === 0) {
            return configOptions;
        }
        const hasModeOption = configOptions.some((option) => isRecord(option) && option.category === "mode");
        if (hasModeOption) {
            return configOptions;
        }
        return [
            ...configOptions,
            {
                id: MODE_CONFIG_ID,
                name: "Mode",
                category: "mode",
                type: "select",
                currentValue: state.currentModeId,
                options: state.availableModes.map((mode) => ({
                    value: mode.id,
                    name: mode.name,
                    ...(mode.description ? { description: mode.description } : {}),
                })),
            },
        ];
    }
}
function parseModeState(value) {
    if (!isRecord(value) || typeof value.currentModeId !== "string" || !Array.isArray(value.availableModes)) {
        return null;
    }
    const availableModes = value.availableModes.flatMap((mode) => isRecord(mode) && typeof mode.id === "string"
        ? [
            {
                id: mode.id,
                name: typeof mode.name === "string" ? mode.name : mode.id,
                ...(typeof mode.description === "string" ? { description: mode.description } : {}),
            },
        ]
        : []);
    return { currentModeId: value.currentModeId, availableModes };
}
