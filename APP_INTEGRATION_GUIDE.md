# 接入 4A 统一登录 —— App 端改造手册

面向对象：smartbid.site 家族下的各个独立产品（sph、joyread、以及未来新增的应用），需要从"纯匿名使用"接入"手机号注册/登录"功能。

4A（本仓库）已经完成了接入所需的全部服务端能力，本手册只描述**你的 app 需要做什么**。4A 侧不需要你改代码或提工单即可完成接入，除非你的子域名前缀和你想要的 client_id 不一致（见下文"特殊情况"）。

## 1. 身份模型：先理解这几个前提

- 一个手机号在 `*.smartbid.site` 全家桶下**只有一个账号**。用户在任意一个子域登录过，其他子域大概率能直接识别出他是谁，不需要重复登录。
- **4A 只负责"这个人是谁"，不负责你的业务数据。** 收藏、历史记录、使用配额、个性化设置——这些都应该留在你自己 app 的数据库里，用 4A 返回的数字 `user.id` 做外键去关联，不要往 4A 里塞业务字段，也不要指望 4A 帮你存这些。
- 每个新注册用户会自动获得一份 FREE 订阅（这是 4A 平台级的免费额度机制，和你的产品是否用到 AI 无关，不需要你做任何处理）。
- 推荐的落地方式是**软门槛**：默认保持匿名可用，只有当用户触发"需要身份"的具体动作时（比如保存记录、解锁额度、个性化功能），才引导登录。不要在用户第一次打开页面时就强制弹登录。

## 2. 接入前提

你的产品域名必须是 `smartbid.site` 的子域（例如 `sph.smartbid.site`）。4A 的登录页跳转白名单是按 `*.smartbid.site` 后缀匹配的，新子域名**自动生效，不需要找 4A 维护者加白名单**。

`client_id`（用来区分是哪个 app 发起的登录、做单实例登录互斥、写审计日志）默认取你子域名的第一段：`sph.smartbid.site` → `sph`，`joyread.smartbid.site` → `joyread`。**如果你想要的 client_id 和子域名第一段不一致**，才需要找 4A 维护者在 `static/login.html` 的 `CLIENT_ID_ALIASES` 和 `api/auth_routes.py` 的 `_CLIENT_ID_ALIASES` 里各加一条别名（两处要同时加，保持一致）。

## 3. 客户端接入（前端，任意框架/技术栈通用）

核心逻辑三步：查 cookie → 没有就跳登录页 → 回跳后落地 token。不依赖任何前端框架，纯浏览器 API 即可实现：

```js
const TOKEN_KEY = 'access_token';
const LOGIN_URL = 'https://auth.smartbid.site/login'; // 实际域名以你们的部署为准

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// 页面加载时调用一次：尝试从 URL 或跨子域 cookie 恢复登录态
function initSSO() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('sso_token');

  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    // 清理 URL，避免 token 留在地址栏/浏览记录里
    params.delete('sso_token');
    const newUrl = window.location.pathname +
      (params.toString() ? '?' + params.toString() : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
    return urlToken;
  }

  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;

  // 跨子域 cookie 兜底：用户在别的 smartbid 系产品登录过，这里免登录识别
  const cookieToken = getCookie('sso_token');
  if (cookieToken) {
    localStorage.setItem(TOKEN_KEY, cookieToken);
    return cookieToken;
  }

  return null;
}

// 需要身份时才调用：跳转到 4A 登录页，登录/注册完会自动带 sso_token 跳回当前页面
function requireLogin() {
  const currentUrl = window.location.href;
  window.location.href = `${LOGIN_URL}?redirect=${encodeURIComponent(currentUrl)}`;
}
```

使用方式：
- 页面加载时调 `initSSO()`，拿到 token 就说明已登录，把它带在你自己后端请求的 `Authorization: Bearer <token>` 头里
- 用户触发需要身份的动作、但 `initSSO()` 没拿到 token 时，调 `requireLogin()`——用户会看到 4A 的统一登录页（手机号验证码为主，未注册自动创建账号），完成后自动跳回你的页面并带上 `sso_token`

## 4. 服务端验证（后端，任意语言/运行时通用）

拿到前端传来的 token 后，调 4A 的 `verify` 端点确认有效性并拿到真实用户信息：

```bash
curl -X GET https://auth.smartbid.site/api/auth/verify \
  -H "Authorization: Bearer <token>"
```

返回（token 有效时，HTTP 200）：
```json
{
  "id": 123,
  "username": "user_1234ab12",
  "email": "13800138000@sms.smartbid.site",
  "phone": "13800138000",
  "full_name": null,
  "role": "user",
  "is_active": true,
  "primary_group_id": null,
  "created_at": "2026-09-04T10:00:00",
  "updated_at": "2026-09-04T10:00:00",
  "last_login_at": "2026-09-04T10:00:00"
}
```

**用返回的数字 `id` 作为你自己数据库里的外键**，不要用 `phone` 或 `username`——手机号理论上可能变更绑定，`username` 对短信注册用户是随机生成的，只有 `id` 是稳定不变的。

token 无效/过期时返回 401，这种情况下：清掉本地存的 token，下次需要身份的动作重新走 `requireLogin()`。

## 5. Token 生命周期，几个要知道的细节

- token 有效期 24 小时
- **同一个 client_id 下只允许一个活跃 token**：同一个用户在你的 app 上换了台设备/浏览器重新登录，旧的会话会失效（拿旧 token 请求会收到"您的账号已在其他地方登录"）。但**不同 app（不同 client_id）之间互不影响**——用户可以同时在 SmartBid 和 sph 上保持登录，不会互相顶号
- 收到 401 就是 token 失效了（过期、被顶号、或用户在别处改了密码），不需要区分原因，统一走"清 token + 重新登录"处理即可

## 6. 明确不要做的事

- **不要直连 `/api/auth/login` 或 `/api/auth/register`**——这两个端点是历史遗留路径，当前唯一真实的注册/登录入口是 4A 统一登录页里的短信验证码流程（`/api/auth/sms/login`，未注册手机号自动创建账号）。直连这两个端点意味着你要自己实现验证码 UI、密码规则校验等一整套东西，没有必要
- **不要在你的前端/后端存用户密码**——4A 是唯一的密码持有方，你只需要 token
- **不要假设手机号是永久不变的用户标识**——用 `/api/auth/verify` 返回的 `id`
