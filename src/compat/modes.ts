import { isRecord } from "../json-rpc.js";

type ModeState = {
  currentModeId: string;
  availableModes: { id: string; name: string; description?: string }[];
};

const MODE_CONFIG_ID = "mode";

/**
 * Command Code はモードを `modes` で返し、configOptions には model / effort しか入れない。
 * Paseo は config_option_update を受けるとモード一覧を configOptions から作り直すため、
 * モデルや effort を変えた直後からモードが空になり切り替えられなくなる。
 * そこで configOptions に mode カテゴリの select を補う。
 */
export class ModeCompat {
  private readonly sessions = new Map<string, ModeState>();

  /** session/new・load・resume の結果からモードを記録し、configOptions に補う。 */
  applySessionResult(sessionId: string, result: Record<string, unknown>): Record<string, unknown> {
    const modes = parseModeState(result.modes);
    if (modes) {
      this.sessions.set(sessionId, modes);
    }
    if (!Array.isArray(result.configOptions)) {
      return result;
    }
    return { ...result, configOptions: this.withModeOption(sessionId, result.configOptions) };
  }

  setCurrentMode(sessionId: string, modeId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.currentModeId = modeId;
    }
  }

  withModeOption(sessionId: string, configOptions: unknown[]): unknown[] {
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

function parseModeState(value: unknown): ModeState | null {
  if (!isRecord(value) || typeof value.currentModeId !== "string" || !Array.isArray(value.availableModes)) {
    return null;
  }
  const availableModes = value.availableModes.flatMap((mode) =>
    isRecord(mode) && typeof mode.id === "string"
      ? [
          {
            id: mode.id,
            name: typeof mode.name === "string" ? mode.name : mode.id,
            ...(typeof mode.description === "string" ? { description: mode.description } : {}),
          },
        ]
      : [],
  );
  return { currentModeId: value.currentModeId, availableModes };
}
