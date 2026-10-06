import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CUSTOM_PRESET_KEY, PROVIDER_PRESETS, presetKeyForBaseUrl, type ProviderPreset } from "@/lib/providers";

/** 服务商预设选择器：选中后自动带出 API 地址与推荐模型。 */
export function ProviderPresetSelect({
  baseUrl,
  onPick,
}: {
  baseUrl: string;
  onPick: (preset: ProviderPreset) => void;
}) {
  const value = presetKeyForBaseUrl(baseUrl);
  return (
    <Select
      value={value}
      onValueChange={(key) => {
        if (key === CUSTOM_PRESET_KEY) return; // 自定义：保留现有手填内容
        const preset = PROVIDER_PRESETS.find((p) => p.key === key);
        if (preset) onPick(preset);
      }}
    >
      <SelectTrigger className="bg-zinc-950 border-zinc-700 h-9 w-full">
        <SelectValue placeholder="选择服务商，自动填入接口地址与模型" />
      </SelectTrigger>
      <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-h-80">
        {PROVIDER_PRESETS.map((p) => (
          <SelectItem key={p.key} value={p.key} className="focus:bg-zinc-800 cursor-pointer">
            <span>{p.name}</span>
            <span className="ml-2 text-xs text-zinc-500">{p.model}</span>
          </SelectItem>
        ))}
        <SelectItem value={CUSTOM_PRESET_KEY} className="focus:bg-zinc-800 cursor-pointer text-zinc-400">
          自定义 / 其他（手动填写）
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
