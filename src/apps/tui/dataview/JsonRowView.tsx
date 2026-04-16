import { Text } from "../ui/Text"

export function JsonRowView(props: { rows: object[] }) {
  return (
    <box flexDirection="column">
      {props.rows.map((row, index) => (
        <Text key={index}>{JSON.stringify(row, null, 2)}</Text>
      ))}
    </box>
  )
}
