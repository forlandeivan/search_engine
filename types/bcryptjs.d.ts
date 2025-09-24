declare module "bcryptjs" {
  const bcrypt: {
    hash(data: string, salt: string | number): Promise<string>;
    hashSync(data: string, salt: string | number): string;
    compare(data: string, encrypted: string): Promise<boolean>;
    compareSync(data: string, encrypted: string): boolean;
    genSalt(rounds?: number): Promise<string>;
    genSaltSync(rounds?: number): string;
  };

  export default bcrypt;
}
