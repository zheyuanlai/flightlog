export class ProviderError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}
