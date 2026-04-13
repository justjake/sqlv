export type JsonPrimitive = string | number | boolean | null
export interface JsonArray<Extra = never> extends Array<Json<Extra>> {}
export interface JsonObject<Extra = never> {
  [key: string]: Json<Extra>
}
export type Json<Extra = never> = JsonPrimitive | JsonArray<Extra> | JsonObject<Extra> | Extra

export type JsonEncoded<T> = string & { __jsontype__: T }
