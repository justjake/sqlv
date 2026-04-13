import type { KeyEvent, MouseEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState, type ReactNode } from "react";

type ShortcutUniqueProps = {
  label: ReactNode;
  onKey: ((key: KeyEvent | MouseEvent) => void) | undefined;
  detect?: (key: KeyEvent) => boolean;
  enabled: boolean | undefined;
};

const OWN_PROPS: Record<keyof ShortcutUniqueProps, true> = {
  onKey: true,
  detect: true,
  label: true,
};

export type ShortcutProps = ShortcutUniqueProps & Partial<KeyEvent>;

export function Shortcut(props: ShortcutProps) {
  const { label, onKey, enabled } = props;
  const [active, setActive] = useState(false);
  useKeyboard((event) => {
    if (!enabled) {
      return;
    }
    if (isMatchingEvent(event, props)) {
      setActive(true);
      setTimeout(() => setActive(false), 300);
      onKey(event);
    }
  });

  return (
    <box
      backgroundColor={active ? "blue" : "gray"}
      onMouseDown={() => {
        if (enabled) {
          setActive(true);
        }
      }}
      onMouseUp={(ev) => {
        setActive(false);
        onKey(ev);
      }}
      paddingLeft={1}
      paddingRight={1}
      opacity={enabled ? 1 : 0.5}
    >
      {labelize(props)} {label}
    </box>
  );
}

function labelize(props: ShortcutProps) {
  let result = "";
  if (props.ctrl) {
    result += "^";
  }
  if (props.shift) {
    result += "⬆";
  }
  if (props.hyper) {
    result += "cmd"; // cmd
  }
  if (props.option) {
    result += "⌥";
  }
  if (props.name) {
    result += props.name;
  }
  return result;
}

function isMatchingEvent(event: KeyEvent, props: ShortcutProps) {
  for (const key in props) {
    if (key in OWN_PROPS) {
      continue;
    }

    const requestedValue = props[key];
    const actualValue = event?.[key];
    if (requestedValue && !(requestedValue === actualValue)) {
      return false;
    }
    if (!requestedValue && actualValue) {
      return false;
    }
  }

  if (props.detect) {
    return props.detect(event);
  }

  return true;
}
