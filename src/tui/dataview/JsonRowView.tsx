export function JsonRowView(props: { rows: object[] }) {
  return (
    <box flexDirection="column">
      {props.rows.map((row, index) => (
        <text key={index}>{JSON.stringify(row, null, 2)}</text>
      ))}
    </box>
  );
}
