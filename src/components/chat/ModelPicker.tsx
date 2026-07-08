// The model pill — a searchable combobox over every configured model.
//
// A plain Select doesn't cut it here: there are 200+ models across a dozen
// providers, so the picker leads with a search field (auto-focused on open) and
// filters as you type. Flow: click the pill → type "glm 5" → arrow to the match
// → Enter → done. Built on Base UI's Combobox (its Select sibling can't host an
// input), styled to match the app's other popups.

import { useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { IconSearch, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import type { Model } from "@/lib/pi/types";

// Each item carries the wire id (`provider/id`) plus a display label. Base UI
// uses `.value` for identity/equality and `.label` for the input text + filter.
interface ModelItem {
  value: string;
  label: string;
  provider: string;
  id: string;
}
interface ModelGroup {
  value: string; // provider name — the group heading
  items: ModelItem[];
}

export function ModelPicker({
  model,
  availableModels,
  onSelectModel,
  triggerClassName,
}: {
  model: Model | null;
  availableModels: Model[];
  onSelectModel: (provider: string, modelId: string) => void;
  triggerClassName?: string;
}) {
  const shape = useShape();

  // Group models by provider, preserving first-seen order.
  const groups = useMemo<ModelGroup[]>(() => {
    const map = new Map<string, ModelItem[]>();
    for (const m of availableModels) {
      const arr = map.get(m.provider) ?? [];
      arr.push({
        value: `${m.provider}/${m.id}`,
        label: m.name || m.id,
        provider: m.provider,
        id: m.id,
      });
      map.set(m.provider, arr);
    }
    return [...map].map(([provider, items]) => ({ value: provider, items }));
  }, [availableModels]);

  const selected = useMemo<ModelItem | null>(() => {
    if (!model) return null;
    const value = `${model.provider}/${model.id}`;
    return {
      value,
      label: model.name || model.id,
      provider: model.provider,
      id: model.id,
    };
  }, [model]);

  return (
    <Combobox.Root
      items={groups}
      value={selected}
      // Identity by wire id — the selected object is rebuilt each render, so
      // referential equality would never match the highlighted list item.
      isItemEqualToValue={(a: ModelItem | null, b: ModelItem | null) =>
        a?.value === b?.value
      }
      onValueChange={(item: ModelItem | null) => {
        if (item) onSelectModel(item.provider, item.id);
      }}
      // Highlight the first match while typing so Enter selects it immediately.
      autoHighlight
    >
      <Combobox.Trigger
        className={cn(
          "inline-flex items-center gap-1 outline-none",
          triggerClassName,
        )}
      >
        <Combobox.Value>
          {(v: ModelItem | null) => (
            <span className="truncate">{v?.label ?? "Model"}</span>
          )}
        </Combobox.Value>
        <IconChevron />
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 outline-none"
        >
          <Combobox.Popup
            className={cn(
              "flex max-h-[min(420px,var(--available-height))] w-[280px] flex-col overflow-hidden",
              shape.container,
              "border border-border bg-popover text-popover-foreground",
              "shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)]",
              "[transform-origin:var(--transform-origin)]",
              "transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
            )}
          >
            {/* Search header — auto-focused on open. */}
            <div className="flex items-center gap-2 border-b border-border/70 px-3">
              <IconSearch
                size={15}
                className="shrink-0 text-muted-foreground/70"
              />
              <Combobox.Input
                placeholder="Search models…"
                className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </div>

            <Combobox.Empty className="px-3 py-6 text-center text-[13px] text-muted-foreground">
              No models found
            </Combobox.Empty>

            <Combobox.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
              {(group: ModelGroup) => (
                <Combobox.Group
                  key={group.value}
                  items={group.items}
                  className="mb-1 last:mb-0"
                >
                  <Combobox.GroupLabel className="px-2.5 pt-2 pb-1 text-[10.5px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                    {group.value}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(item: ModelItem) => (
                      <Combobox.Item
                        key={item.value}
                        value={item}
                        className={cn(
                          "flex h-9 cursor-pointer items-center gap-2 px-2.5 text-[13px]",
                          shape.item,
                          "text-muted-foreground outline-none select-none",
                          "transition-colors duration-75",
                          "data-[highlighted]:bg-hover data-[highlighted]:text-foreground",
                          "data-[selected]:text-foreground",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                        </span>
                        <Combobox.ItemIndicator>
                          <IconCheck size={15} className="shrink-0" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

// Chevron matching the Select trigger's.
function IconChevron() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground transition-colors duration-80 group-hover:text-foreground"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
