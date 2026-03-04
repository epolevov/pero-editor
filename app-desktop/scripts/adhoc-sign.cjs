const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

module.exports = async function adhocSign(context) {
  if (process.platform !== 'darwin') {
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)

  if (!fs.existsSync(appPath)) {
    throw new Error(`Cannot ad-hoc sign app: file not found at ${appPath}`)
  }

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })

  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  })
}
