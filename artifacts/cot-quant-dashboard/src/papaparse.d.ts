declare module "papaparse" {
  type ParseError = { message: string };
  type ParseResult<T> = { data: T[]; errors: ParseError[] };
  const Papa: {
    parse<T>(input: string, options: { header?: boolean; dynamicTyping?: boolean; skipEmptyLines?: boolean }): ParseResult<T>;
    unparse(data: unknown[]): string;
  };
  export default Papa;
}
