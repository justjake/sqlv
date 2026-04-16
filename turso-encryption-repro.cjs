const turso = require("@tursodatabase/database")

async function main() {
  const key = crypto.getRandomValues(Buffer.alloc(32)).toString("hex")

  const db = await turso.connect("./encrypted-test.db", {
    encryption: {
      cipher: "aegis256",
      hexkey: key,
    },
  })

  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)")
  db.exec("INSERT INTO test (name) VALUES (?)", ["test"])
  console.log(await db.prepare("SELECT * FROM test").all())
}

main()
