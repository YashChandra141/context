declare module "*.sql" {
  const source: string;
  export default source;
}

declare module "qrcode" {
  const QRCode: {
    toString(text: string, options?: { type?: string; small?: boolean }): Promise<string>;
  };
  export default QRCode;
}
