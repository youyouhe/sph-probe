# OAuth2 登录改造 E2E 验收清单(smartbid.site 家族通用)

> 前置:`OAUTH2_CODE_FLOW=1`、`OAUTH2_JTI_ENABLED=1`、`OAUTH2_REVOKE_ENABLED=1`
> 已在 4A 生产环境开启;本应用的 client 已登记(registry require_pkce=true)。
> 每项通过打 ✅;发现回归记录到运维台账后再继续下一项。

## A. 主链路(冷启动)

| # | 场景 | 操作 | 预期 |
|---|------|------|------|
| A1 | 授权码登录 | 无痕窗口打开应用 → 点登录 | 跳 4A 登录页;验证码登录后 302 回 `/?code=…&state=…`,**地址栏 1s 内被清空**(replaceState) |
| A2 | token 落地 | A1 完成后看顶栏 | 显示用户(手机号打码);Network 里 `POST /api/token`(sph)或 `/api/auth/token`(grid)返回 200 带 `access_token` |
| A3 | 业务请求带身份 | 触发一次计费动作 | 响应按登录用户额度计(`dailyRemaining`/`quota.used` 按 user 池) |

## B. 共存与免登(迁移期特有)

> 迁移台账:**sph-probe 已于 2026-09-25 删除内联 `?sso_token=` 兜底与跨子域 cookie 读路径**
> (index.html OAuth2-P6 收尾);身份只经授权码交换落地,免登一律走 authorize 静默换发(B2)。
> B1/B3 在 sph-probe 上按"已删除"预期验收;其他家族应用删除前仍按原预期。

| # | 场景 | 操作 | 预期 |
|---|------|------|------|
| B1 | cookie 兜底跨应用免登 | 在未迁移应用登录,再开本应用 | ~~免登录直接是登录态~~ **sph-probe 已删除 cookie 读路径**:打开即匿名态,点登录后经 authorize 静默换发进入登录态(B2);其他未删兜底的应用仍是免登直进 |
| B2 | authorize 静默换发 | token 过期后再点登录 | 4A 见 cookie 有效,静默 302 带码回来,全程无登录表单一闪 |
| B3 | legacy ?sso_token= 直链 | 模拟旧链接 `?sso_token=<token>` | ~~token 落地 localStorage,URL 被清,抑制标志被解除~~ **sph-probe 已删除兜底**:页面按匿名处理,token 不落地 localStorage,URL 参数保留不清(无 handler);其他未删兜底的应用仍是落地+清 URL |

## C. 登出

| # | 场景 | 操作 | 预期 |
|---|------|------|------|
| C1 | 本站登出 | 点退出 | 顶栏未登录;`POST /api/auth/logout` 代理已转发(4A 侧审计有记录);**共享 cookie 已删** |
| C2 | 登出后不再弹回 | C1 后立刻再点登录 | 能看到 4A 登录表单(不被 Auto-SSO 弹回)——grid 2026-09 踩过的坑 |
| C3 | 全局登出(grid 专属) | 点全家桶登出 | 4A 吊销全部 token 后回跳;其他应用下次请求 401 |

## D. 健壮性

| # | 场景 | 操作 | 预期 |
|---|------|------|------|
| D1 | 授权码重放 | A1 后立即 F5 刷新 | 不报错不死循环;页面正常(码一次性,交换失败走沿用/重登分支) |
| D2 | 篡改 state | 手工改 URL 里 state 后回车 | 静默丢弃(交换不发起),无跳转 |
| D3 | 互踢 | 同账号两台设备登录同一应用 | 先登录侧在下一次计费请求 401 → 清 token → 重新登录 |
| D4 | 4A 宕机降级 | (灰度期)停 4A | verify 失败 fail-open 按匿名;交换失败 502 `auth_unavailable`,前端不死循环 |
| D5 | 防回弹闸 | 人为让交换持续失败(如改错 4A 端点) | 页面停在未登录态,不出现 4A↔应用 无限重定向 |
| D6 | 钓鱼回调拒绝 | curl 伪造 `redirect_uri=https://evil.com/` 调交换代理 | 400 invalid_request |

## E. 审计观察(4A 侧)

- `oauth2_authorize` 事件计数与 `client_id` 分布(grid/sph/smartbid)
- legacy `login` 计数应随迁移逐步下降
- `/oauth2/token` 的 4xx(过期/重放/PKCE 错误)比例异常升高要查前端

## F. legacy 兜底删除后的同步审计(2026-09-25,sph-probe)

- 前端 `index.html`:内联 `?sso_token=` 兜底与 `document.cookie` 读 `sso_token` 路径(含 `logout()` 的 cookie token 回退审计)已全部删除;`deleteSsoCookie()`(写路径)保留——登出/防 Auto-SSO 弹回仍需删共享 cookie(见 C2)。
- 服务端 `worker.js`:审计通过,无需改动——`bearerToken()` 只读 `Authorization: Bearer` 头,不读 cookie、不收 URL token;4A token 只经前端授权码交换落地。
- 回归点:handleOauth2Callback 仍在启动序列最前;原 initSSO 的调用时机(非回调时)删除后无副作用——恢复登录态完全由 B2 静默换发承接。
