type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>
    mobile?: boolean
    platform?: string
  }
}

export function isCurrentBrowserChromium() {
  if (typeof navigator === "undefined") {
    return true
  }

  return isChromiumNavigator(navigator)
}

function isChromiumNavigator(navigatorValue: NavigatorWithUserAgentData) {
  const userAgent = navigatorValue.userAgent
  const userAgentLower = userAgent.toLowerCase()
  const platform = (
    navigatorValue.userAgentData?.platform ??
    navigatorValue.platform ??
    ""
  ).toLowerCase()
  const isIos =
    /iphone|ipad|ipod/.test(userAgentLower) ||
    platform === "ios" ||
    (platform === "macintel" && navigatorValue.maxTouchPoints > 1)

  if (isIos) {
    return false
  }

  const brands = navigatorValue.userAgentData?.brands ?? []

  if (
    brands.some(({ brand }) =>
      /\b(chromium|google chrome|microsoft edge)\b/i.test(brand)
    )
  ) {
    return true
  }

  return /\b(chrome|chromium|edg|opr)\//i.test(userAgent)
}
