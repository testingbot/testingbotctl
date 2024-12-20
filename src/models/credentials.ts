export default class Credentials {
  private _userName: string;
  private _accessKey: string;

  public constructor(userName: string, accessKey: string) {
    this._userName = userName;
    this._accessKey = accessKey;
  }

  public get userName(): string {
    return this._userName;
  }

  public get accessKey(): string {
    return this._accessKey;
  }

  public toString(): string {
    return this.userName + ':' + '*'.repeat(this.accessKey.length);
  }
}
