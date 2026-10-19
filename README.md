# Fast Note Sync For Obsidian · 博客魔改版

> 这是 [`haierkeys/obsidian-fast-note-sync`](https://github.com/haierkeys/obsidian-fast-note-sync) 的个人魔改分支备份。
> **官方文档、安装说明、多语言 README、上游更新请直接看官方仓库** —— 本文件只讲魔改了什么。

插件侧的同步引擎、REST/WebSocket 客户端、冲突解决、云预览、Git 同步等能力**全部保留未动**。这个分支只在设置页加了一个区块，其余改动都发生在服务端。

**博客功能的主体在服务端**:见 [`fast-note-sync-service-blog`](https://github.com/ywdddddddddd/fast-note-sync-service-blog)。
本文件末尾有一份博客功能索引，指向那边对应的小节。

---

## 一、插件侧改了什么

只有四处，都很小:

| 文件 | 改动 |
| --- | --- |
| `src/setting.tsx` | 新增 `renderBlogPageSettings(set)`,在 `renderBlogAskSettings` 之前调用 |
| `src/i18n/locales/{zh-CN,zh-TW,en,ja,ko}.ts` | 各补 `setting.blog_page.*` 共 14 个键 |
| `src/styles.scss` | `.fns-blog-page-status` / `-row` / `-label` |
| `main.js` / `styles.css` | 构建产物(见 §三) |

### `renderBlogPageSettings` 做什么

一件很具体的事:**确保 vault 里存在一篇简历页笔记**，因为博客的 `/blog/about` 由它渲染。

- **候选路径**(按序尝试):`简历/关于.md` → `简历/about.md` → `关于.md` → `about.md`
- **目标路径**:`简历/关于.md`
- **只创建，永不覆盖已有文件**
- 用 `normalizePath`,避免不同平台的路径分隔符让判断失效

笔记内容是一个可用的起点(四个页面容器加上占位文字),不是最终稿 —— 简历当然要自己写。

### i18n

五种语言各 14 个键，**五份键集必须完全一致**。新增语言或新增键时，把 `en` 那份当作基准逐条对齐。

---

## 二、构建

```bash
# 1. 先编译 SCSS
npx sass src/styles.scss styles.css --style=expanded --no-source-map

# 2. 再打包
pnpm run build
```

**`pnpm run build` 不编译 SCSS。** 改了 `src/styles.scss` 却没跑第 1 步，样式不会变，而且**没有任何报错** —— 这是本仓库最容易浪费时间的坑。

### 部署

把 `main.js` / `styles.css` / `manifest.json` 复制到:

```
<your-vault>/.obsidian/plugins/fast-note-sync/
```

然后在 Obsidian 设置里重载插件。

---

## 三、这份备份包含构建产物

上游的 `.gitignore` 排除了 `main.js`(约定"编译产物走 GitHub Releases")。本备份用 `git add -f` **强制保留了它和 `styles.css`**,所以这份仓库里的代码是**可以直接装进 vault 用的**,不需要先自己构建。

代价是:改源码之后如果不重新构建，仓库里的 `main.js` 会与源码不一致。**提交前记得跑一遍 §二的命令。**

如果你想恢复上游的干净约定，把 `main.js` 从 `.gitignore` 放回来即可(`git rm --cached main.js`)。

---

## 四、读写注意

- **esbuild 会压缩局部变量名**,并把非 ASCII 字符转义成大写 `\uXXXX`。对构建产物做断言时只能用 **ASCII 字面量或函数名**,不能用中文字符串或变量名
- 设置页是 TSX，样式在 `src/styles.scss`，两者分开构建(见 §二)

---

## 五、博客功能索引

博客的完整说明在服务端仓库的 README 里。对应关系:

| 想了解 | 看服务端的 |
| --- | --- |
| 页面有哪些路由、slug 怎么算 | §一 博客是什么形态 |
| 为什么 Markdown 渲染是这个顺序 | §二 渲染管线 |
| `==高亮==`、单换行、笔记嵌入、callout 怎么处理 | §三 Markdown 方言 |
| `::: profile-*` 那套页面容器 | §四 页面容器 |
| 点赞/点踩/访问次数存哪、为什么不用数据库 | §五 互动 |
| 首页粒子场、星域穿越、加载动画 | §六 首页动效 |
| 知识图谱(d3) | §七 知识图谱 |
| 手机上的书签与抽屉 | §八 移动端 |
| 笔记正文/附件到底存在哪 | §九 数据存储 |
| 怎么编译运行服务端 | §十 构建与运行 |
| 合并上游时冲突会在哪 | §十二 与上游的关系 |

---

## 六、与上游的关系

本仓库 `origin` 指向这份备份，`upstream` 指向官方:

```bash
git fetch upstream
git log --oneline upstream/master ^HEAD   # 看上游多了什么
git merge upstream/master                 # 合并
```

插件侧的改动很少，冲突风险主要在 `src/setting.tsx` 与五个 i18n 文件 —— 上游经常动这两处。

---

## 七、已知问题

1. **设置页还没有粒子数与喷粪开关的界面** —— 这两个配置项(`particle-count`、`dislike-burst`)在服务端已生效，但目前只能手工编辑 `config.yaml`
2. **插件侧的博客管理面板是小范围的** —— 只做"确保简历页存在"这一件事，不做内容编辑。内容在 Obsidian 里写，这是刻意的

---

## 许可

与上游一致(见 `LICENSE`)。本仓库是个人备份，未向上游提 PR。
