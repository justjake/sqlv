import * as turso from "@tursodatabase/database"
const db = new turso.Database("./foo.db")
const stmt = db.prepare("select $1")

await db.connect()

debugger

console.log(await stmt.bind(["wat"]).all())
