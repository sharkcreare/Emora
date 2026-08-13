import { app } from 'electron'

/** 读取开机启动状态 */
export function getAutoLaunch(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

/** 设置开机启动（Windows 写入注册表 Run 项，随系统启动、最小化运行） */
export function setAutoLaunch(enable: boolean): boolean {
  app.setLoginItemSettings({ openAtLogin: enable, openAsHidden: true })
  return getAutoLaunch()
}
