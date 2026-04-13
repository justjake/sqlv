import { Shortcut } from "../Shortcut";

export type EditorProps = {
  focused?: boolean;
  value: EditorState;
  onChange?: (val: EditorState) => void;
  onExecute?: () => void;
  onEsc?: () => void;
};

type EditorState = {
  text: string;
  sensitive: boolean;
};

export function EditorView(props: EditorProps) {
  const { value, focused, onExecute, onChange } = props;

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <Shortcut
          label="Execute"
          ctrl
          name="x"
          enabled={focused}
          onKey={onExecute}
        />
        <Shortcut
          label="Clear"
          ctrl
          name="d"
          enabled={focused}
          onKey={() =>
            onChange?.({
              ...value,
              text: "",
            })
          }
        />
      </box>
      <textarea
        focused={focused}
        value={value.text} // ??
        onSubmit={onExecute}
        onContentChange={(v) => {
          console.log("onContentChange", v);
          onChange?.({
            ...value,
            text: v.value,
          });
        }}
      />
    </box>
  );

  // <box style={{ flexDirection: 'column'}}>

  //   </box>
}
