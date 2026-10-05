# 墨卷 NovelForge 上线部署清单

按序执行。带 ☐ 的为可勾选项。

## 一、支付商户开通（真实收单前置条件）

**微信支付（Native 扫码）**
1. 注册微信支付商户号（pay.weixin.qq.com），开通「Native 支付」。
2. 申请 API 证书（商户私钥 `apiclient_key.pem` 与证书序列号），设置 APIv3 密钥。
3. 配置支付回调地址（要求公网 HTTPS）：`https://你的域名/api/pay/wechat/notify`。
4. 可选：下载平台证书，导出 PEM 文本用于回调验签（`WXPAY_PLATFORM_CERT`）。

**支付宝（电脑网站支付）**
1. 开放平台（open.alipay.com）创建应用，签约「电脑网站支付」，获取 AppID。
2. 生成应用 RSA2 密钥对，上传应用公钥，获取支付宝公钥。
3. 配置异步回调地址：`https://你的域名/api/pay/alipay/notify`；
   同步跳转页（可选）：`https://你的域名/billing`。
4. 建议先用沙箱联调（设置 `ALIPAY_SANDBOX=1`）。

## 二、服务器环境变量清单

```bash
# 基础
NOVEL_ADMIN_USER=admin                # 管理员账号（首次启动创建）
NOVEL_ADMIN_PASSWORD=强密码            # 务必修改默认 admin123
NOVEL_DEFAULT_QUOTA=100               # 历史字段，新用户实际为免费套餐 20 章/月

# 模型服务商（管理员也可登录后台在网页上配置，二选一）
# （后台配置优先，无需环境变量）

# 支付通道：mock（默认演示）/ wechat / alipay
PAY_CHANNEL=mock

# 微信支付 V3（PAY_CHANNEL=wechat 或用户选择微信时必填）
WXPAY_APPID=wxXXXXXXXX
WXPAY_MCHID=16xxxxxxxx
WXPAY_SERIAL=证书序列号
WXPAY_PRIVATE_KEY_PATH=/secure/apiclient_key.pem
WXPAY_APIV3_KEY=32位APIv3密钥
WXPAY_NOTIFY_URL=https://你的域名/api/pay/wechat/notify
WXPAY_PLATFORM_CERT=平台证书PEM文本（回调验签用）

# 支付宝（用户选择支付宝时必填）
ALIPAY_APP_ID=20210XXXXXXXXXXX
ALIPAY_PRIVATE_KEY_PATH=/secure/app_private_key.pem
ALIPAY_PUBLIC_KEY_PATH=/secure/alipay_public_key.pem
ALIPAY_NOTIFY_URL=https://你的域名/api/pay/alipay/notify
ALIPAY_RETURN_URL=https://你的域名/billing
ALIPAY_SANDBOX=0                      # 沙箱联调时设 1
```

> 安全提示：所有私钥/密钥放服务器文件系统并限制权限（400），不要写进仓库；
> 环境变量也不要提交到代码库。

## 三、部署步骤

☐ 1. **改管理员默认密码**：登录后台后立即修改（重新设置环境变量或重建库），
    并妥善保管 `backend/data/secret.key`——丢失则所有已存 API Key 无法解密。

☐ 2. **备份策略**：每日备份 `backend/data/`（platform.db + secret.key）。
    SQLite 备份直接复制文件即可（WAL 模式下建议用 `.backup` 命令或停机后备份）。

☐ 3. **HTTPS 反向代理**（Caddy 示例）：
    ```
    your-domain.com {
        reverse_proxy 127.0.0.1:3000
    }
    /api/* 反代到 127.0.0.1:8787
    ```
    支付回调与支付宝 return_url 都依赖公网 HTTPS 域名。

☐ 4. **收紧 CORS**：`backend/app/main.py` 中将允许来源从 `*` 改为你的域名。

☐ 5. **进程常驻**：
    - 开发/内测：`cd frontend && npm run dev`（一键拉起 8787 + 3000）。
    - 生产：后端 `uvicorn app.main:app --port 8787 --host 127.0.0.1`（systemd/pm2 守护）；
      前端 `npm run build` 后用 nginx/Caddy 托管 `frontend/dist`，
      并将 `/api` 路径反代到 8787。

☐ 6. **首次启动**：注册首个用户 → 管理员登录后台 →「服务商配置」填入你的
    模型 API Key（Kimi/DeepSeek/通义，OpenAI 兼容接口均可）→ 用免费额度实测
    一本书全流程（策划→逐章→审校→导出）。

## 四、支付验收 checklist

☐ 模拟通道：下单 → 模拟支付 → 额度立即到账（管理端订单显示 paid / trade_no=mock）。

☐ 微信通道：下单选微信 → 弹出二维码 → 扫码付款 → 约 2-5 秒内前端自动关闭弹窗并提示到账；
    管理端订单出现第三方单号（trade_no）。

☐ 支付宝通道：下单选支付宝 → 跳转收银台 → 付款 → 回到站点；
    管理端订单状态 paid（支付宝为异步通知，若页面未及时刷新属正常）。

☐ 回调安全：伪造回调（错误签名/篡改金额）不会发放额度——
    金额核对失败时网关会重推，订单保持 pending。

☐ 幂等：同一笔订单重复回调/重复点击支付，额度只发放一次。

## 五、日常运营

- **对账**：管理后台「订单管理」trade_no 列可与微信/支付宝商户后台账单核对；
  「用量监控」的 Token 总量对应你给模型商的账单，用于核算毛利。
- **定价调整**：改 `backend/app/catalog.py` 后重启后端生效（已购用户权益不变，
  新订单按新价）。
- **用户支持**：额度未到账先查订单状态；需要补偿时在「用户管理」手动调整加油包余额。
- **扩容**：用户量上来后把 SQLite 换成 PostgreSQL（数据访问集中在 `db.py`），
  生成队列从单进程串行改为多 worker。
