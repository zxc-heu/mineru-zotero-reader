var CodexZoteroBridge = {
  endpoint: "/connector/codex/attachLinkedFile",
  previousEndpoint: null,
  menuElements: [],
  menuListeners: [],
  activeProgressWidget: null,

  modes: {
    quickread: {
      label: "快读",
      filename: "_quickread.md",
      instruction: "快读：判断这篇论文是否值得继续精读，输出结构化快速阅读笔记。"
    },
    deepread: {
      label: "精读",
      filename: "_deepread.md",
      instruction: "精读：把论文转化为可复用的研究知识，输出结构化精读笔记。"
    },
    "writing-read": {
      label: "写作级精读",
      filename: "_writing-read.md",
      instruction: "写作级精读：分析论文结构、方法、图表、公式和可复用写作模式，输出写作级阅读笔记。"
    }
  },

  async startup() {
    await Zotero.initializationPromise;
    this.registerEndpoint();
    this.registerMenus();
    Zotero.debug("Codex Zotero Bridge started");
  },

  registerEndpoint() {
    this.previousEndpoint = Zotero.Server.Endpoints[this.endpoint] || null;

    const BridgeEndpoint = function () {};
    BridgeEndpoint.prototype = {
      supportedMethods: ["POST"],
      supportedDataTypes: ["application/json"],
      permitBookmarklet: false,

      init: async function (requestData) {
        try {
          const data = requestData.data || {};
          const parentKey = String(data.parentKey || "").trim();
          const file = String(decodeMaybeUtf8Base64(data.fileBase64Utf8, data.file) || "").trim();
          const title = String(decodeMaybeUtf8Base64(data.titleBase64Utf8, data.title) || "").trim();
          const updateAttachmentKey = String(data.updateAttachmentKey || "").trim();
          const contentType = String(data.contentType || "text/markdown").trim();

          if (!parentKey) {
            return jsonResponse(400, { error: "PARENT_KEY_NOT_PROVIDED" });
          }
          if (!file) {
            return jsonResponse(400, { error: "FILE_NOT_PROVIDED" });
          }
          if (!file.toLowerCase().endsWith(".md")) {
            return jsonResponse(400, { error: "ONLY_MARKDOWN_FILES_ALLOWED" });
          }

          const parent = await Zotero.Items.getByLibraryAndKeyAsync(
            Zotero.Libraries.userLibraryID,
            parentKey
          );
          if (!parent) {
            return jsonResponse(404, { error: "PARENT_NOT_FOUND", parentKey });
          }
          if (parent.isAttachment()) {
            return jsonResponse(400, { error: "PARENT_IS_ATTACHMENT", parentKey });
          }

          if (updateAttachmentKey) {
            const attachment = await Zotero.Items.getByLibraryAndKeyAsync(
              Zotero.Libraries.userLibraryID,
              updateAttachmentKey
            );
            if (!attachment || !attachment.isAttachment()) {
              return jsonResponse(404, { error: "ATTACHMENT_NOT_FOUND", attachmentKey: updateAttachmentKey });
            }
            if (attachment.parentID !== parent.id) {
              return jsonResponse(400, {
                error: "ATTACHMENT_PARENT_MISMATCH",
                attachmentKey: updateAttachmentKey,
                parentKey
              });
            }
            attachment.setField("title", title || PathUtils.filename(file));
            attachment.attachmentPath = file;
            await attachment.saveTx();
            return jsonResponse(200, {
              attached: true,
              updated: true,
              alreadyAttached: false,
              attachmentKey: attachment.key,
              parentKey,
              file
            });
          }

          const targetPath = normalizePath(file);
          const attachmentIDs = parent.getAttachments();
          for (const attachmentID of attachmentIDs) {
            const attachment = await Zotero.Items.getAsync(attachmentID);
            if (!attachment || !attachment.isAttachment()) {
              continue;
            }
            const existingPath = attachment.getFilePath && attachment.getFilePath();
            if (existingPath && normalizePath(existingPath) === targetPath) {
              return jsonResponse(200, {
                attached: false,
                alreadyAttached: true,
                attachmentKey: attachment.key,
                parentKey,
                file
              });
            }
          }

          const item = await Zotero.Attachments.linkFromFile({
            file,
            parentItemID: parent.id,
            title: title || PathUtils.filename(file),
            contentType
          });

          return jsonResponse(201, {
            attached: true,
            alreadyAttached: false,
            attachmentKey: item.key,
            parentKey,
            file
          });
        }
        catch (e) {
          Zotero.logError(e);
          return jsonResponse(500, {
            error: "ATTACH_LINKED_FILE_FAILED",
            message: String(e && e.message || e)
          });
        }
      }
    };

    Zotero.Server.Endpoints[this.endpoint] = BridgeEndpoint;
    Zotero.debug("Codex Zotero Bridge registered " + this.endpoint);
  },

  registerMenus() {
    const windows = Zotero.getMainWindows ? Zotero.getMainWindows() : [Zotero.getMainWindow()];
    for (const win of windows) {
      if (win && win.document) {
        this.registerMenuForWindow(win);
      }
    }
  },

  registerMenuForWindow(win) {
    const doc = win.document;
    const popup = doc.querySelector("#zotero-itemmenu");
    if (!popup || doc.querySelector("#codex-zotero-bridge-read-menu")) {
      return;
    }

    const menu = createXULElement(doc, "menu");
    menu.setAttribute("id", "codex-zotero-bridge-read-menu");
    menu.setAttribute("label", "一键阅读");
    menu.setAttribute("class", "menuitem-iconic");
    menu.setAttribute("image", "chrome://codex-zotero-bridge/content/icons/bridge.svg");

    const subPopup = createXULElement(doc, "menupopup");
    subPopup.setAttribute("id", "codex-zotero-bridge-read-popup");

    for (const mode of ["quickread", "deepread", "writing-read"]) {
      const item = createXULElement(doc, "menuitem");
      item.setAttribute("id", "codex-zotero-bridge-read-" + mode);
      item.setAttribute("data-codex-reading-mode", mode);
      item.setAttribute("label", this.modes[mode].label);
      item.addEventListener("command", () => {
        this.runReadingMode(mode).catch((e) => {
          Zotero.logError(e);
          this.showMessage("一键阅读失败", readableError(e), 8000);
        });
      });
      subPopup.appendChild(item);
      this.menuElements.push(item);
    }

    const separator = createXULElement(doc, "menuseparator");
    subPopup.appendChild(separator);
    this.menuElements.push(separator);

    const loginItem = createXULElement(doc, "menuitem");
    loginItem.setAttribute("id", "codex-zotero-bridge-login");
    loginItem.setAttribute("label", "检查 Codex CLI 状态...");
    loginItem.addEventListener("command", () => {
      this.runCodexLoginAssistant().catch((e) => {
        Zotero.logError(e);
        this.showMessage("Codex 登录检查失败", readableError(e), 10000);
      });
    });
    subPopup.appendChild(loginItem);
    this.menuElements.push(loginItem);

    menu.appendChild(subPopup);
    popup.appendChild(menu);
    this.menuElements.push(menu);

    const onShowing = () => {
      const selected = this.getSelectedItems();
      const available = selected.length > 0;
      const modeItems = subPopup.querySelectorAll("[data-codex-reading-mode]");
      if (available) {
        for (const item of modeItems) {
          item.removeAttribute("disabled");
        }
      }
      else {
        for (const item of modeItems) {
          item.setAttribute("disabled", "true");
        }
      }
    };
    popup.addEventListener("popupshowing", onShowing);
    this.menuListeners.push({ popup, onShowing });
  },

  async runReadingMode(mode) {
    const modeSpec = this.modes[mode];
    if (!modeSpec) {
      throw new Error("未知阅读模式：" + mode);
    }

    const selection = await this.resolveSelectedPdfTargets();
    const targets = selection.targets;
    if (!targets.length) {
      throw new Error([
        "未找到可阅读的 PDF 附件。请右键选择文献条目或 PDF 附件。",
        selection.skipped.length ? "" : null,
        selection.skipped.length ? "跳过项：" : null,
        selection.skipped.join("\n")
      ].filter(Boolean).join("\n"));
    }

    const progress = this.showProgress(
      "一键阅读",
      "准备检查 Codex CLI 状态"
    );
    const summary = {
      done: [],
      skipped: selection.skipped.slice(),
      failed: []
    };

    const configuredCodexPath = this.getPref("codexPath", "codex");
    const codexPath = resolveCodexPath(configuredCodexPath);
    try {
      updateProgress(progress, "正在检查 Codex CLI 登录状态", {
        current: 0,
        total: targets.length
      });
      await this.ensureCodexLoggedIn(configuredCodexPath, codexPath);
    }
    catch (e) {
      updateProgress(progress, readableError(e), {
        current: 0,
        total: targets.length,
        failed: true
      });
      closeProgress(progress, 15000);
      return;
    }

    const cacheRoot = normalizeLocalPath(getCacheRoot());
    await ensureDirectory(cacheRoot);
    await ensureDirectory(cacheRoot + "\\uv-cache");
    await ensureDirectory(cacheRoot + "\\uv-python");
    await ensurePythonShim(cacheRoot);

    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      const label = targetLabel(target);
      const notePath = noteMarkdownPath(target.pdfPath, mode);
      if (fileExists(notePath)) {
        summary.skipped.push(label + "：已存在 " + notePath);
        updateProgress(progress, batchProgressLine(index + 1, targets.length, "跳过已读：" + label), {
          current: index + 1,
          total: targets.length
        });
        continue;
      }

      updateProgress(progress, batchProgressLine(index + 1, targets.length, "正在阅读：" + label), {
        current: index + 1,
        total: targets.length
      });
      try {
        await this.runSingleReadingTarget({
          mode,
          target,
          configuredCodexPath,
          codexPath,
          cacheRoot,
          progress
        });
        summary.done.push(label + "：" + notePath);
        updateProgress(progress, batchProgressLine(index + 1, targets.length, "完成：" + label), {
          current: index + 1,
          total: targets.length
        });
      }
      catch (e) {
        Zotero.logError(e);
        summary.failed.push(label + "：" + readableError(e));
        updateProgress(progress, batchProgressLine(index + 1, targets.length, "失败，继续下一篇：" + label), {
          current: index + 1,
          total: targets.length,
          failed: true
        });
      }
    }

    const finalSummary = buildBatchSummary(modeSpec.label, summary);
    updateProgress(progress, finalSummary, {
      current: targets.length,
      total: targets.length,
      failed: summary.failed.length > 0
    });
    closeProgress(progress, summary.failed.length ? 12000 : 3000);

    if (summary.failed.length && !summary.done.length && !summary.skipped.length) {
      throw new Error(buildBatchSummary(modeSpec.label, summary));
    }
  },

  async runSingleReadingTarget(context) {
    const target = context.target;
    const pdfDir = parentDir(target.pdfPath);
    const workspace = this.getPref("workspace", pdfDir);
    const logPath = buildLogPath(pdfDir, context.mode);
    const mineruLogPath = buildMineruLogPath(pdfDir, context.mode);
    const promptPath = buildPromptPath(pdfDir, context.mode);
    const runnerPath = buildRunnerPath(pdfDir, context.mode);
    const env = buildBridgeEnv(context.cacheRoot);
    const status = {
      logPath,
      mineruLogPath,
      statusPath: buildStatusPath(target.pdfPath, context.mode),
      sourceMdPath: sourceMarkdownPath(target.pdfPath),
      noteMdPath: noteMarkdownPath(target.pdfPath, context.mode),
      skillRoot: "",
      mineruScriptPath: ""
    };
    const monitor = startProgressMonitor(context.progress, status);

    try {
      await writeReadingStatus(status.statusPath, buildReadingStatusPayload("starting", context, status));
      const preprocess = await this.ensureSourceMarkdown(context, status, env);
      const prompt = this.buildPrompt(context.mode, target, context.cacheRoot, preprocess);
      await IOUtils.writeUTF8(promptPath, prompt);

      const args = [
        "exec",
        "--cd", workspace,
        "--skip-git-repo-check",
        "--sandbox", "workspace-write",
        "-c", "approval_policy=\"never\"",
        "--add-dir", pdfDir,
        "--add-dir", context.cacheRoot,
        "-"
      ];
      const invocation = await buildExecInvocation(context.codexPath, args, promptPath, logPath, env, runnerPath);
      Zotero.debug("Codex Zotero Bridge launching: " + invocation.path + " " + invocation.args.join(" "));
      await writeReadingStatus(status.statusPath, buildReadingStatusPayload("codex_running", context, Object.assign({}, status, preprocess)));
      await Zotero.Utilities.Internal.exec(invocation.path, invocation.args);
      const logInfo = inspectCodexLog(logPath);
      if (!fileExists(status.noteMdPath)) {
        const noteBody = logInfo.noteBody;
        if (!noteBody) {
          throw new Error("Codex 任务已结束，但未找到阅读笔记文件，也未在日志中找到阅读笔记标记块：" + status.noteMdPath);
        }
        await IOUtils.writeUTF8(status.noteMdPath, noteBody.replace(/\s+$/, "") + "\n");
      }
      if (!fileExists(status.noteMdPath)) {
        throw new Error("阅读笔记写入失败，未找到文件：" + status.noteMdPath);
      }
      await this.attachNoteToParent(target.parentItem, status.noteMdPath, context.mode);
      await writeReadingStatus(status.statusPath, buildReadingStatusPayload(preprocess.fallback ? "completed_with_fallback" : "completed", context, Object.assign({}, status, preprocess, {
        zoteroLinked: true,
        noteBlockCount: logInfo.noteBlockCount,
        rawNoteMarkerBlockCount: logInfo.rawNoteMarkerBlockCount,
        noteMarkerWarning: logInfo.noteMarkerWarning,
        transportWarning: logInfo.transportWarning
      })));
    }
    catch (e) {
      await writeReadingStatus(status.statusPath, buildReadingStatusPayload("failed", context, Object.assign({}, status, {
        error: readableError(e)
      })));
      const failure = buildFailureMessage({
        configuredCodexPath: context.configuredCodexPath,
        codexPath: context.codexPath,
        logPath,
        error: e
      });
      throw new Error(failure.message);
    }
    finally {
      stopProgressMonitor(monitor);
      await removeFileIgnoreMissing(promptPath);
      await removeFileIgnoreMissing(runnerPath);
    }
  },

  async ensureSourceMarkdown(context, status, env) {
    if (fileExists(status.sourceMdPath)) {
      return {
        sourceMarkdownExists: true,
        mineruRan: false,
        mineruDownloadFailure: false,
        fallback: false,
        fallbackDigest: ""
      };
    }

    const skill = resolveSkillRoot(this.getPref("skillRoot", ""));
    status.skillRoot = skill.root;
    status.mineruScriptPath = skill.mineruScriptPath;
    await writeReadingStatus(status.statusPath, buildReadingStatusPayload("mineru_running", context, status));
    const args = [
      "run",
      "--python", "3.12",
      "python",
      skill.mineruScriptPath,
      context.target.pdfPath,
      "--json-summary",
      "--download-retries", "5",
      "--download-retry-delay", "8"
    ];
    const mineruRunnerPath = buildTempPath("mineru-parse", ".runner.vbs");
    let mineruError = "";
    try {
      const invocation = await buildShellInvocation("uv", args, status.mineruLogPath, env, mineruRunnerPath);
      await Zotero.Utilities.Internal.exec(invocation.path, invocation.args);
    }
    catch (e) {
      mineruError = readableError(e);
    }
    finally {
      await removeFileIgnoreMissing(mineruRunnerPath);
    }

    if (fileExists(status.sourceMdPath)) {
      return {
        sourceMarkdownExists: true,
        mineruRan: true,
        mineruDownloadFailure: false,
        fallback: false,
        fallbackDigest: ""
      };
    }

    const mineruLog = readLog(status.mineruLogPath);
    const mineruDownloadFailure = isMineruDownloadFailure(mineruLog);
    if (context.mode === "quickread") {
      const fallbackDigest = buildZoteroFullTextDigest(parentDir(context.target.pdfPath));
      if (fallbackDigest) {
        const fallback = {
          sourceMarkdownExists: false,
          mineruRan: true,
          mineruDownloadFailure,
          fallback: true,
          fallbackReason: "MinerU failed; quickread used Zotero full-text cache.",
          fallbackDigest
        };
        await writeReadingStatus(status.statusPath, buildReadingStatusPayload("mineru_failed_quickread_fallback", context, Object.assign({}, status, fallback, {
          error: mineruError || lastNonEmptyLine(mineruLog)
        })));
        return fallback;
      }
    }

    await writeReadingStatus(status.statusPath, buildReadingStatusPayload("mineru_failed", context, Object.assign({}, status, {
      sourceMarkdownExists: false,
      mineruRan: true,
      mineruDownloadFailure,
      error: mineruError || lastNonEmptyLine(mineruLog)
    })));
    throw new Error("MinerU failed before Codex reading. See log: " + status.mineruLogPath);
  },

  async ensureCodexLoggedIn(configuredCodexPath, codexPath) {
    const status = await runCodexLoginStatus(codexPath);
    if (/not logged in/i.test(status.output)) {
      throw new Error([
        "Codex CLI 尚未登录。",
        "请在 Windows 终端手动运行下面的 standalone Codex CLI 登录命令，完成后再回到 Zotero 重试。",
        "",
        "当前 CLI 配置：" + configuredCodexPath,
        "实际执行路径：" + codexPath,
        "登录检查日志：" + status.logPath,
        "可手动运行：" + quoteWindowsCommand([codexPath, "login", "--device-auth"])
      ].join("\n"));
    }
  },

  async attachNoteToParent(parentItem, notePath, mode) {
    if (!parentItem || !notePath || !fileExists(notePath)) {
      return null;
    }

    const targetPath = normalizePath(notePath);
    const attachmentIDs = parentItem.getAttachments ? parentItem.getAttachments() : [];
    for (const attachmentID of attachmentIDs) {
      const attachment = await Zotero.Items.getAsync(attachmentID);
      if (!attachment || !attachment.isAttachment()) {
        continue;
      }
      const existingPath = attachment.getFilePath && attachment.getFilePath();
      if (existingPath && normalizePath(existingPath) === targetPath) {
        return attachment;
      }
    }

    const title = this.noteAttachmentTitle(parentItem, mode);
    return Zotero.Attachments.linkFromFile({
      file: notePath,
      parentItemID: parentItem.id,
      title,
      contentType: "text/markdown"
    });
  },

  noteAttachmentTitle(parentItem, mode) {
    const modeSpec = this.modes[mode];
    const prefix = modeSpec ? modeSpec.label + "笔记" : "阅读笔记";
    const title = parentItem && parentItem.getField ? parentItem.getField("title") : "";
    return title ? prefix + " - " + title : prefix;
  },

  async runCodexLoginAssistant() {
    const configuredCodexPath = this.getPref("codexPath", "codex");
    const codexPath = resolveCodexPath(configuredCodexPath);
    const status = await runCodexLoginStatus(codexPath);

    if (!/not logged in/i.test(status.output)) {
      this.showMessage(
        "Codex CLI 已登录",
        [
          "Codex CLI 可以使用。",
          "",
          "当前 CLI 配置：" + configuredCodexPath,
          "实际执行路径：" + codexPath,
          "",
          status.output.trim()
        ].join("\n"),
        7000
      );
      return;
    }

    this.showMessage(
      "Codex CLI 未登录",
      [
        "Zotero 不再自动打开登录窗口，请手动运行下面的命令。",
        "完成登录后，再回到 Zotero 重新点击一键阅读。",
        "",
        "当前 CLI 配置：" + configuredCodexPath,
        "实际执行路径：" + codexPath,
        "登录状态日志：" + status.logPath,
        "可手动运行：" + quoteWindowsCommand([codexPath, "login", "--device-auth"])
      ].join("\n"),
      15000
    );
  },

  buildPrompt(mode, target, cacheRoot, preprocess) {
    const modeSpec = this.modes[mode];
    const title = target.parentItem.getField ? (target.parentItem.getField("title") || "") : "";
    const doi = target.parentItem.getField ? (target.parentItem.getField("DOI") || "") : "";
    const year = target.parentItem.getField ? (target.parentItem.getField("date") || "") : "";
    const pdfPath = target.pdfPath;
    const pdfDir = parentDir(pdfPath);
    const sourceMd = sourceMarkdownPath(pdfPath);
    const noteMd = noteMarkdownPath(pdfPath, mode);
    const mineruDir = String(pdfPath).replace(/\.pdf$/i, "_mineru");
    const quickreadDigest = mode === "quickread" ? buildQuickreadSourceDigest(sourceMd) : "";
    const fallbackDigest = preprocess && preprocess.fallbackDigest ? preprocess.fallbackDigest : "";
    const quickreadRules = mode === "quickread" ? [
      "快读边界：快读是结构化筛选笔记，不是简陋摘要，也不替代精读。",
      "快读应保留研究问题、主要方法、主要结论、相关性判断、是否值得精读、判断理由、后续精读回查建议。",
      "快读正文建议约 1500-2500 中文字；高相关论文可略长，低相关论文应更短。",
      "源 Markdown 已存在且下方提供“快读材料摘录”时，直接基于摘录生成笔记；不要再完整读取源 Markdown。",
      "只有摘录乱码、缺失摘要/结论或明显无法支撑判断时，才允许对源 Markdown 做一次有界补读；不要把整篇 Markdown 输出到日志。",
      "快读默认不检查 _mineru 目录；只有 Markdown 无法支撑判断时，才允许回查一次。",
      "快读通常不嵌入图片；只有某张图直接影响相关性判断、方法判断或是否值得精读时，才嵌入该关键图并说明原因。",
      "快读禁止逐图逐表解释、公式重建、系统证据链整理和多轮关键词探索。",
      "快读笔记也必须包含“保存前自检”小节：检查中文 UTF-8、frontmatter、快读边界、关键图路径（若有）和后续回查建议。",
      "写入阅读笔记后只检查目标笔记文件是否存在；不要预览、二次读取或继续润色输出文件。"
    ] : [];
    const richReadingRules = mode === "deepread" || mode === "writing-read" ? [
      "图像策略：按论文证据需要选择关键图，不设置固定嵌图数量。",
      "必须检查源 Markdown 图片链接和 _mineru/images 资源；不能只根据图号概括图表。",
      mode === "deepread"
        ? "精读应嵌入所有没有图就难以理解证据链的关键图；非关键图只保留图号、caption 和简短作用说明。"
        : "写作级精读应嵌入所有对文章结构、方法呈现、结果组织、图表模仿有直接价值的关键图；不为凑数量嵌图，也不机械限制数量。",
      "如果论文图很少且都关键，可以全部嵌入；如果论文图很多，只嵌入支撑核心论证、证据链或写作模仿任务的图。",
      "关键图表解读不能只列图号，必须说明图回答了什么问题、支撑什么结论、在论文论证链中处于什么位置。",
      "识别关键表格和参数表，避免漏掉实验条件、模型参数、评价指标和对照结果。",
      "公式规则：行内公式必须使用 $...$，独立公式使用成对 $$ 块；禁止输出裸露的 \\(...\\)、\\[...\\]、\\times、\\mathrm、^、_ 等 LaTeX 片段。",
      "Markdown 表格单元格里如需写核素、数量级或单位，也必须用行内公式，例如 $^{60}\\mathrm{Co}$、$2.48 \\times 10^7\\ \\mathrm{Bq}$、$\\mu\\mathrm{Sv}/\\mathrm{h}$。",
      "不要把完整公式、判据、模型方程或评价指标写进 Markdown 表格单元格；表格里只放短标签、数值、单位、变量名或公式编号，完整公式必须放在表格外的独立 $$ 块中。",
      "如果需要展示分类规则或指标定义，先用表格列出类别/指标/含义，再在表格下方按编号给出完整可渲染公式；保存前检查全文不得残留裸露的 \\times、\\mathrm、\\boldsymbol 或未包裹的上标表达。",
      "对 MinerU 识别出的公式做轻度清理，尤其是松散空格的核素、上下标和矩阵表达；同时解释公式在论证链中的作用。",
      "关键结论后尽量保留源证据锚点，例如 Figure、Table、公式、Methods 小节、Results 段落或 caption。",
      "记录 MinerU/OCR 解析风险：公式识别异常、图表切分错误、caption 不完整、表格丢列、图片路径缺失或中文/英文编码异常。",
      "精读和写作级精读笔记必须包含“保存前自检”小节。",
      "保存前自检：中文应为可读 UTF-8，嵌入图片路径应能相对笔记位置解析，独立公式应使用成对 $$，图表说明应包含证据作用，Markdown 表格内不得承载完整公式。"
    ] : [];

    return [
      "执行 Zotero PDF 一键阅读任务。不要探索 Zotero 写入 API；不要尝试创建 Zotero 条目；Zotero 插件会在 Codex 结束后自动挂回笔记。",
      "",
      "阅读模式：" + modeSpec.label,
      "内部命令：" + mode,
      "模式要求：" + modeSpec.instruction,
      "",
      "Zotero parent item key: " + target.parentItem.key,
      "Zotero PDF attachment key: " + target.pdfAttachment.key,
      "PDF 本地路径: " + pdfPath,
      "PDF 目录: " + pdfDir,
      "源 Markdown 目标路径: " + sourceMd,
      "MinerU 输出目录目标路径: " + mineruDir,
      "阅读笔记目标路径: " + noteMd,
      "题名: " + title,
      "日期: " + year,
      "DOI: " + doi,
      "",
      quickreadRules.length ? "快读模式约束：" : "",
      ...quickreadRules,
      quickreadRules.length ? "" : "",
      richReadingRules.length ? "精读/写作级精读质量约束：" : "",
      ...richReadingRules,
      richReadingRules.length ? "" : "",
      quickreadDigest ? "快读材料摘录（插件已从源 Markdown 有界提取；优先使用这部分，不要再完整读取源 Markdown）：" : "",
      quickreadDigest,
      quickreadDigest ? "" : "",
      fallbackDigest ? "降级快读材料摘录（MinerU 未生成 Markdown；只能用于快读筛选，必须在 frontmatter 和正文中标注 degraded_fallback: true）：" : "",
      fallbackDigest,
      fallbackDigest ? "" : "",
      "执行要求：",
      "1. MinerU preprocessing has already been handled by the Zotero bridge before this Codex run. Do not run MinerU, uv, Python parsing scripts, curl, Node, or any PDF parser.",
      "2. If the source Markdown exists, read it with bounded reads only. Do not dump the full Markdown into the log.",
      "3. If a degraded quickread digest is provided above, use only that digest and clearly mark the note as degraded fallback. Deepread and writing-read should never run without source Markdown.",
      "4. 不要运行写入脚本，不要创建临时正文文件，不要把正文放进 PowerShell 命令。",
      "5. 最终回复必须包含完整阅读笔记，并且只输出一次下面的标记块；插件会在 Codex 结束后从日志提取并写入目标路径：" + noteMd,
      "   ::codex-zotero-note-start::",
      "   <这里放完整 Markdown 阅读笔记，必须包含 YAML frontmatter>",
      "   ::codex-zotero-note-end::",
      "6. 标记块之外只返回简短结果：源 Markdown 路径、MinerU 输出目录路径、阅读笔记路径。",
      "7. 不要预览、二次读取或继续润色输出文件。",
      "8. 不要调用 Zotero helper、不要请求 Zotero local API 写入、不要检查 attach-linked-file；插件会自动挂回。",
      "9. 插件负责写入阅读笔记；如果你自己写文件，会让日志变脏。"
    ].filter((line) => line !== "").join("\n");
  },

  getSelectedItems() {
    try {
      const pane = Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane();
      if (pane && pane.getSelectedItems) {
        return pane.getSelectedItems() || [];
      }
    }
    catch (e) {
      Zotero.logError(e);
    }
    return [];
  },

  isPotentialReadingTarget(item) {
    if (!item) {
      return false;
    }
    if (item.isAttachment && item.isAttachment()) {
      return this.isPdfAttachment(item);
    }
    return item.isRegularItem && item.isRegularItem();
  },

  async resolveSelectedPdfTargets() {
    const selected = this.getSelectedItems();
    const targets = [];
    const skipped = [];
    const seen = new Set();

    for (const item of selected) {
      try {
        const target = await this.resolvePdfTarget(item);
        if (!target) {
          skipped.push(itemLabel(item) + "：未找到 PDF 附件");
          continue;
        }
        const key = target.pdfAttachment.key || normalizePath(target.pdfPath);
        if (seen.has(key)) {
          skipped.push(targetLabel(target) + "：重复选择，已跳过");
          continue;
        }
        seen.add(key);
        targets.push(target);
      }
      catch (e) {
        skipped.push(itemLabel(item) + "：" + readableError(e));
      }
    }
    return { targets, skipped };
  },

  async resolvePdfTarget(item) {
    if (!item) {
      return null;
    }

    if (item.isAttachment && item.isAttachment()) {
      if (!this.isPdfAttachment(item)) {
        return null;
      }
      const parentID = item.parentItemID;
      if (!parentID) {
        throw new Error("该 PDF 附件没有父文献条目。");
      }
      const parentItem = await Zotero.Items.getAsync(parentID);
      const pdfPath = item.getFilePath && item.getFilePath();
      if (!pdfPath) {
        throw new Error("无法取得 PDF 本地路径。");
      }
      return { parentItem, pdfAttachment: item, pdfPath };
    }

    if (!(item.isRegularItem && item.isRegularItem())) {
      return null;
    }

    const attachmentIDs = item.getAttachments ? item.getAttachments() : [];
    for (const attachmentID of attachmentIDs) {
      const attachment = await Zotero.Items.getAsync(attachmentID);
      if (!attachment || !this.isPdfAttachment(attachment)) {
        continue;
      }
      const pdfPath = attachment.getFilePath && attachment.getFilePath();
      if (pdfPath) {
        return { parentItem: item, pdfAttachment: attachment, pdfPath };
      }
    }
    return null;
  },

  isPdfAttachment(item) {
    if (!item || !(item.isAttachment && item.isAttachment())) {
      return false;
    }
    const contentType = String(item.attachmentContentType || "").toLowerCase();
    if (contentType === "application/pdf") {
      return true;
    }
    const path = item.getFilePath && item.getFilePath();
    return Boolean(path && path.toLowerCase().endsWith(".pdf"));
  },

  getPref(name, fallback) {
    const fullName = "extensions.codexZoteroBridge." + name;
    try {
      const value = Zotero.Prefs.get(fullName, true);
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    catch (e) {
      Zotero.logError(e);
    }
    return fallback;
  },

  setPref(name, value) {
    const fullName = "extensions.codexZoteroBridge." + name;
    try {
      Zotero.Prefs.set(fullName, String(value || ""), true);
    }
    catch (e) {
      Zotero.logError(e);
    }
  },

  showMessage(title, message, timeout) {
    try {
      const progress = new Zotero.ProgressWindow();
      progress.changeHeadline(title);
      progress.addDescription(message);
      progress.show();
      progress.startCloseTimer(timeout || 4000);
    }
    catch (e) {
      try {
        Zotero.getMainWindow().alert(title + "\n\n" + message);
      }
      catch (inner) {
        Zotero.logError(e);
        Zotero.logError(inner);
      }
    }
  },

  showProgress(title, message, state) {
    try {
      return this.createInlineProgress(title, message, state);
    }
    catch (e) {
      Zotero.logError(e);
      this.showMessage(title, message, 5000);
      return null;
    }
  },

  createInlineProgress(title, message, state) {
    const win = Zotero.getMainWindow();
    const doc = win.document;
    this.closeInlineProgressNow();

    const box = createHtmlElement(doc, "div");
    box.setAttribute("id", "codex-zotero-bridge-progress");
    box.setAttribute("style", [
      "position: fixed",
      "right: 18px",
      "bottom: 18px",
      "z-index: 2147483647",
      "width: min(420px, calc(100vw - 36px))",
      "max-height: 260px",
      "box-sizing: border-box",
      "padding: 12px 12px 10px",
      "border: 1px solid rgba(20,20,20,.18)",
      "border-radius: 8px",
      "background: rgba(255,255,255,.98)",
      "box-shadow: 0 10px 30px rgba(0,0,0,.18)",
      "font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "color: #1f2328"
    ].join(";"));

    const header = createHtmlElement(doc, "div");
    header.setAttribute("style", "display:flex;align-items:center;gap:8px;margin-bottom:8px;");

    const titleEl = createHtmlElement(doc, "div");
    titleEl.textContent = title;
    titleEl.setAttribute("style", "font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");

    const closeButton = createHtmlElement(doc, "button");
    closeButton.setAttribute("type", "button");
    closeButton.setAttribute("aria-label", "关闭阅读进度");
    closeButton.textContent = "×";
    closeButton.setAttribute("style", [
      "width: 24px",
      "height: 24px",
      "border: 0",
      "border-radius: 4px",
      "background: transparent",
      "font-size: 20px",
      "line-height: 20px",
      "cursor: pointer",
      "color: #4b5563"
    ].join(";"));

    const detailEl = createHtmlElement(doc, "div");
    detailEl.setAttribute("style", [
      "white-space: pre-wrap",
      "overflow: auto",
      "max-height: 165px",
      "word-break: break-word"
    ].join(";"));

    header.appendChild(titleEl);
    header.appendChild(closeButton);
    box.appendChild(header);
    box.appendChild(detailEl);

    closeButton.addEventListener("click", () => {
      handle.closed = true;
      if (handle.closeTimer) {
        clearTimeout(handle.closeTimer);
      }
      this.closeInlineProgressNow(handle);
    });

    const parent = doc.body || doc.documentElement;
    parent.appendChild(box);

    const handle = {
      win,
      box,
      titleEl,
      detailEl,
      closeTimer: null,
      closed: false
    };
    this.activeProgressWidget = handle;
    updateProgress(handle, message, state || {});
    return handle;
  },

  closeInlineProgressNow(handle) {
    const target = handle || this.activeProgressWidget;
    if (!target) {
      return;
    }
    try {
      if (target.closeTimer) {
        clearTimeout(target.closeTimer);
      }
      if (target.box && target.box.parentNode) {
        target.box.parentNode.removeChild(target.box);
      }
    }
    catch (e) {
      Zotero.logError(e);
    }
    if (!handle || this.activeProgressWidget === handle) {
      this.activeProgressWidget = null;
    }
  },

  async shutdown() {
    this.closeInlineProgressNow();
    for (const entry of this.menuListeners) {
      try {
        entry.popup.removeEventListener("popupshowing", entry.onShowing);
      }
      catch (e) {
        Zotero.logError(e);
      }
    }
    this.menuListeners = [];

    for (const elem of this.menuElements.reverse()) {
      try {
        if (elem && elem.parentNode) {
          elem.parentNode.removeChild(elem);
        }
      }
      catch (e) {
        Zotero.logError(e);
      }
    }
    this.menuElements = [];

    if (this.previousEndpoint) {
      Zotero.Server.Endpoints[this.endpoint] = this.previousEndpoint;
    }
    else {
      delete Zotero.Server.Endpoints[this.endpoint];
    }
    Zotero.debug("Codex Zotero Bridge unregistered " + this.endpoint);
  }
};

function createXULElement(doc, tagName) {
  if (doc.createXULElement) {
    return doc.createXULElement(tagName);
  }
  return doc.createElement(tagName);
}

function createHtmlElement(doc, tagName) {
  return doc.createElementNS("http://www.w3.org/1999/xhtml", tagName);
}

function parentDir(path) {
  return String(path).replace(/[\\/][^\\/]*$/, "");
}

async function buildExecInvocation(commandPath, args, inputPath, logPath, env, runnerPath) {
  const command = String(commandPath || "").trim();
  if (!command) {
    throw new Error("Codex CLI 路径为空。");
  }

  if (Zotero.isWin) {
    const shellCommand = buildWindowsShellCommand(command, args, inputPath, logPath, env);
    await writeWindowsHiddenRunner(runnerPath, shellCommand);
    return {
      path: "C:\\Windows\\System32\\wscript.exe",
      args: ["//B", "//Nologo", runnerPath]
    };
  }

  const shellCommand = buildPosixEnvPrefix(env) +
    quotePosixCommand([command].concat(args)) +
    " < " + quotePosixCommand([inputPath]) +
    " > " + quotePosixCommand([logPath]) + " 2>&1";
  return {
    path: "/bin/sh",
    args: ["-lc", shellCommand]
  };
}

async function buildShellInvocation(commandPath, args, logPath, env, runnerPath) {
  const command = String(commandPath || "").trim();
  if (!command) {
    throw new Error("Codex CLI 路径为空。");
  }

  if (Zotero.isWin) {
    const shellCommand = buildWindowsEnvPrefix(env) +
      quoteWindowsCommand([command].concat(args)) +
      " > " + quoteWindowsCommand([logPath]) + " 2>&1";
    await writeWindowsHiddenRunner(runnerPath, shellCommand);
    return {
      path: "C:\\Windows\\System32\\wscript.exe",
      args: ["//B", "//Nologo", runnerPath]
    };
  }

  const shellCommand = buildPosixEnvPrefix(env) +
    quotePosixCommand([command].concat(args)) +
    " > " + quotePosixCommand([logPath]) + " 2>&1";
  return {
    path: "/bin/sh",
    args: ["-lc", shellCommand]
  };
}

function isAbsoluteOrRelativePath(command) {
  return /[\\/]/.test(command) || /^[a-zA-Z]:/.test(command);
}

function resolveCodexPath(configuredPath) {
  const command = String(configuredPath || "").trim();
  if (!command || command.toLowerCase() !== "codex" || !Zotero.isWin) {
    return command;
  }

  const home = getHomePath();
  if (home) {
    const standalone = home + "\\.codex\\packages\\standalone\\current\\bin\\codex.exe";
    if (fileExists(standalone)) {
      return standalone;
    }
  }
  return command;
}

function suggestedStandaloneCodexPath() {
  const home = getHomePath();
  if (!home) {
    return "";
  }
  return home + "\\.codex\\packages\\standalone\\current\\bin\\codex.exe";
}

function resolveSkillRoot(configuredRoot) {
  const configured = normalizeLocalPath(configuredRoot);
  if (configured) {
    return validateSkillRoot(configured, "extensions.codexZoteroBridge.skillRoot");
  }

  const envRoot = normalizeLocalPath(getEnvironment("CODEX_ZOTERO_READER_SKILL_ROOT"));
  if (envRoot) {
    return validateSkillRoot(envRoot, "CODEX_ZOTERO_READER_SKILL_ROOT");
  }

  const candidates = [];
  const home = getHomePath();
  if (home) {
    addSkillRootCandidate(candidates, home + "\\.codex\\skills\\mineru-zotero-reader");
    addSkillRootCandidate(candidates, home + "\\.agents\\skills\\mineru-zotero-reader");
  }

  for (const root of candidates) {
    const mineruScriptPath = root + "\\scripts\\mineru_precise_parse.py";
    if (fileExists(mineruScriptPath)) {
      return { root, mineruScriptPath };
    }
  }

  throw new Error([
    "MinerU Zotero Reader skill 路径无效，未找到 scripts\\mineru_precise_parse.py。",
    "",
    "请在 Zotero 高级设置中配置：",
    "extensions.codexZoteroBridge.skillRoot",
    "",
    "也可以设置用户环境变量：",
    "CODEX_ZOTERO_READER_SKILL_ROOT",
    "",
    "已检查路径：",
    candidates.length ? candidates.join("\n") : "(无)"
  ].join("\n"));
}

function validateSkillRoot(root, source) {
  const mineruScriptPath = root + "\\scripts\\mineru_precise_parse.py";
  if (fileExists(mineruScriptPath)) {
    return { root, mineruScriptPath };
  }
  throw new Error([
    "MinerU Zotero Reader skill 路径无效，未找到 scripts\\mineru_precise_parse.py。",
    "",
    "配置来源：" + source,
    "当前路径：" + root,
    "期望脚本：" + mineruScriptPath,
    "",
    "请把该配置改为 mineru-zotero-reader 的根目录，或清空该配置后使用默认安装路径。"
  ].join("\n"));
}

function addSkillRootCandidate(candidates, value) {
  const root = normalizeLocalPath(value);
  if (!root) {
    return;
  }
  const key = normalizePath(root);
  for (const existing of candidates) {
    if (normalizePath(existing) === key) {
      return;
    }
  }
  candidates.push(root);
}

function isWindowsAppsPath(path) {
  return /\\WindowsApps\\/i.test(String(path || ""));
}

function getHomePath() {
  try {
    const file = Services.dirsvc.get("Home", Ci.nsIFile);
    return file && file.path;
  }
  catch (e) {
    Zotero.logError(e);
    return "";
  }
}

function fileExists(path) {
  try {
    const file = Components.classes["@mozilla.org/file/local;1"]
      .createInstance(Ci.nsIFile);
    file.initWithPath(path);
    return file.exists() && file.isFile();
  }
  catch (e) {
    Zotero.logError(e);
    return false;
  }
}

function buildLogPath(pdfDir, mode) {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");
  return pdfDir + "\\codex-zotero-reader-" + mode + "-" + stamp + ".log";
}

function buildMineruLogPath(pdfDir, mode) {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");
  return pdfDir + "\\codex-zotero-reader-" + mode + "-mineru-" + stamp + ".log";
}

function buildPromptPath(pdfDir, mode) {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");
  return pdfDir + "\\codex-zotero-reader-" + mode + "-" + stamp + ".prompt.txt";
}

function buildRunnerPath(pdfDir, mode) {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");
  return pdfDir + "\\codex-zotero-reader-" + mode + "-" + stamp + ".runner.vbs";
}

function buildTempPath(prefix, extension) {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");
  return getCacheRoot() + "\\" + prefix + "-" + stamp + extension;
}

function buildStatusPath(pdfPath, mode) {
  return String(pdfPath).replace(/\.pdf$/i, "_" + mode + ".status.json");
}

function sourceMarkdownPath(pdfPath) {
  return String(pdfPath).replace(/\.pdf$/i, ".md");
}

function buildZoteroFullTextDigest(pdfDir) {
  const cachePath = pdfDir + "\\.zotero-ft-cache";
  try {
    if (!fileExists(cachePath)) {
      return "";
    }
    const raw = Zotero.File.getContents(cachePath) || "";
    return truncateText(String(raw).replace(/\r\n/g, "\n"), 12000);
  }
  catch (e) {
    Zotero.logError(e);
    return "";
  }
}

function buildQuickreadSourceDigest(sourceMdPath) {
  try {
    if (!fileExists(sourceMdPath)) {
      return "";
    }
    const raw = Zotero.File.getContents(sourceMdPath) || "";
    return compactMarkdownForQuickread(raw);
  }
  catch (e) {
    Zotero.logError(e);
    return "";
  }
}

function compactMarkdownForQuickread(raw) {
  const maxDigestLength = 24000;
  const maxFrontLength = 7000;
  const maxSectionLength = 2600;
  let text = String(raw || "").replace(/\r\n/g, "\n");
  text = text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, "\n[表格内容已省略，快读阶段不逐表展开]\n");
  text = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return true;
    }
    if (/^<!--/.test(trimmed)) {
      return false;
    }
    if (/^\|.*\|$/.test(trimmed) && trimmed.length > 180) {
      return false;
    }
    return true;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  if (!text) {
    return "";
  }

  const parts = [
    "## 文首材料",
    truncateText(text, maxFrontLength)
  ];
  const headings = [];
  const headingPattern = /^#{1,4}\s+.+$/gm;
  let match;
  while ((match = headingPattern.exec(text)) !== null) {
    headings.push({ title: match[0], index: match.index });
  }

  const sectionKeywords = [
    "abstract", "summary", "introduction", "background", "method", "materials",
    "experiment", "result", "discussion", "conclusion", "limitation",
    "摘要", "关键词", "引言", "背景", "方法", "材料", "实验", "结果", "讨论", "结论", "总结", "局限"
  ];
  const seen = new Set();
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const lower = heading.title.toLowerCase();
    if (!sectionKeywords.some((keyword) => lower.includes(keyword))) {
      continue;
    }
    const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
    const section = text.slice(heading.index, end).trim();
    const key = heading.title.replace(/\s+/g, " ").toLowerCase();
    if (!section || seen.has(key)) {
      continue;
    }
    seen.add(key);
    parts.push("## 结构段落摘录：" + heading.title.replace(/^#{1,4}\s+/, ""));
    parts.push(truncateText(section, maxSectionLength));
    if (parts.join("\n\n").length >= maxDigestLength) {
      break;
    }
  }

  return truncateText(parts.join("\n\n"), maxDigestLength);
}

function truncateText(text, maxLength) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, Math.max(0, maxLength - 28)).replace(/\s+$/, "") + "\n[后续内容已省略]";
}

function noteMarkdownPath(pdfPath, mode) {
  const suffixes = {
    quickread: "_quickread.md",
    deepread: "_deepread.md",
    "writing-read": "_writing-read.md"
  };
  return String(pdfPath).replace(/\.pdf$/i, suffixes[mode] || "_" + mode + ".md");
}

function buildReadingStatusPayload(stage, context, extra) {
  const target = context.target || {};
  const parentItem = target.parentItem || {};
  const title = parentItem.getField ? (parentItem.getField("title") || "") : "";
  return Object.assign({
    stage,
    updatedAt: new Date().toISOString(),
    mode: context.mode,
    pdfPath: target.pdfPath || "",
    parentItemKey: parentItem.key || "",
    pdfAttachmentKey: target.pdfAttachment ? (target.pdfAttachment.key || "") : "",
    title,
    codexPath: context.codexPath || "",
    configuredCodexPath: context.configuredCodexPath || ""
  }, extra || {});
}

async function writeReadingStatus(statusPath, payload) {
  if (!statusPath) {
    return;
  }
  try {
    await IOUtils.writeUTF8(statusPath, "\uFEFF" + safeJsonStringify(payload || {}) + "\n");
  }
  catch (e) {
    Zotero.logError(e);
  }
}

function safeJsonStringify(value) {
  return JSON.stringify(sanitizeJsonValue(value), null, 2);
}

function sanitizeJsonValue(value) {
  if (typeof value === "string") {
    return sanitizeJsonString(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }
  if (value && typeof value === "object") {
    const cleaned = {};
    for (const key of Object.keys(value)) {
      cleaned[sanitizeJsonString(key)] = sanitizeJsonValue(value[key]);
    }
    return cleaned;
  }
  return value;
}

function sanitizeJsonString(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "\uFFFD")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "\uFFFD")
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1\uFFFD");
}

async function runCodexLoginStatus(codexPath) {
  const cacheRoot = normalizeLocalPath(getCacheRoot());
  await ensureDirectory(cacheRoot);
  const logPath = buildTempPath("codex-login-status", ".log");
  const runnerPath = buildTempPath("codex-login-status", ".runner.vbs");
  const env = buildBridgeEnv(cacheRoot);
  const invocation = await buildShellInvocation(codexPath, ["login", "status"], logPath, env, runnerPath);

  try {
    await Zotero.Utilities.Internal.exec(invocation.path, invocation.args);
  }
  catch (e) {
    const output = readLog(logPath);
    if (/not logged in/i.test(output)) {
      return { ok: false, output, logPath };
    }
    const detail = output || readableError(e);
    throw new Error([
      "Codex CLI 登录状态检查失败。",
      "请确认 Codex CLI 已安装，或在 Zotero 高级设置中配置 extensions.codexZoteroBridge.codexPath。",
      isWindowsAppsPath(codexPath) ? "当前路径位于 WindowsApps，可能被系统拒绝直接执行；建议改用 standalone Codex CLI。" : "",
      "",
      "实际执行路径：" + codexPath,
      "建议 standalone 路径：" + suggestedStandaloneCodexPath(),
      "日志文件：" + logPath,
      "",
      detail
    ].filter(Boolean).join("\n"));
  }
  finally {
    await removeFileIgnoreMissing(runnerPath);
  }

  return { ok: true, output: readLog(logPath), logPath };
}

async function launchCodexLoginWindow(codexPath) {
  const cacheRoot = normalizeLocalPath(getCacheRoot());
  await ensureDirectory(cacheRoot);
  const scriptPath = buildTempPath("codex-login", ".cmd");
  const body = [
    "@echo off",
    "chcp 65001 >nul",
    "title Codex CLI Login",
    "echo Codex Zotero Bridge - Codex CLI 登录",
    "echo.",
    "echo 当前 CLI:",
    "echo " + codexPath,
    "echo.",
    "echo 将打开浏览器或显示设备登录码。请按提示完成登录。",
    "echo 登录完成后，本窗口会显示登录状态。",
    "echo.",
    quoteWindowsCommand([codexPath, "login", "--device-auth"]),
    "echo.",
    "echo 当前登录状态:",
    quoteWindowsCommand([codexPath, "login", "status"]),
    "echo.",
    "pause",
    ""
  ].join("\r\n");
  await IOUtils.writeUTF8(scriptPath, body);

  if (Zotero.isWin) {
    await Zotero.Utilities.Internal.exec("C:\\Windows\\System32\\cmd.exe", [
      "/d",
      "/s",
      "/c",
      "start \"Codex CLI Login\" " + quoteWindowsCommand([scriptPath])
    ]);
    return;
  }

  await Zotero.Utilities.Internal.exec(codexPath, ["login", "--device-auth"]);
}

function getCacheRoot() {
  try {
    const tmp = Services.dirsvc.get("TmpD", Ci.nsIFile);
    return normalizeLocalPath(tmp.path) + "\\codex-zotero-reader-cache";
  }
  catch (e) {
    Zotero.logError(e);
    return normalizeLocalPath(getHomePath()) + "\\.codex\\codex-zotero-reader-cache";
  }
}

function normalizeLocalPath(path) {
  return String(path || "").replace(/[\s\u00A0]+$/g, "");
}

function buildBridgeEnv(cacheRoot) {
  const root = normalizeLocalPath(cacheRoot);
  return {
    PATH: root + ";" + getEnvironment("PATH"),
    UV_CACHE_DIR: root + "\\uv-cache",
    UV_PYTHON_INSTALL_DIR: root + "\\uv-python"
  };
}

function startProgressMonitor(progress, status) {
  if (!progress || typeof setInterval !== "function") {
    return null;
  }

  let last = "";
  const timer = setInterval(() => {
    const current = inferProgressStatus(status);
    if (current && current !== last) {
      last = current;
      updateProgress(progress, current);
    }
  }, 5000);
  return timer;
}

function stopProgressMonitor(timer) {
  if (timer && typeof clearInterval === "function") {
    clearInterval(timer);
  }
}

function inferProgressStatus(status) {
  if (fileExists(status.noteMdPath)) {
    return progressLine(4, "阅读笔记已生成，正在挂回 Zotero");
  }
  if (fileExists(status.sourceMdPath)) {
    return progressLine(3, "PDF 已解析，正在生成阅读笔记");
  }

  const tail = readTail(status.mineruLogPath || status.logPath) + "\n" + readTail(status.logPath);
  if (/MinerU|mineru|mineru_precise_parse|parse/i.test(tail)) {
    return progressLine(2, "MinerU 正在解析 PDF");
  }
  if (/OpenAI Codex|workdir:|exec|codex/i.test(tail)) {
    return progressLine(1, "Codex 已启动，正在准备阅读环境");
  }
  return progressLine(1, "正在启动 Codex");
}

function progressLine(step, text) {
  return "第 " + step + " 步：" + text;
}

function batchProgressLine(current, total, text) {
  return "[" + current + "/" + total + "] " + text;
}

function buildBatchSummary(modeLabel, summary) {
  return [
    modeLabel + "批处理完成。",
    "完成：" + summary.done.length + " 篇",
    "跳过：" + summary.skipped.length + " 篇",
    "失败：" + summary.failed.length + " 篇",
    "",
    summary.done.length ? "已完成：\n" + summary.done.join("\n") : "",
    summary.skipped.length ? "已跳过：\n" + summary.skipped.join("\n") : "",
    summary.failed.length ? "失败：\n" + summary.failed.join("\n") : ""
  ].filter(Boolean).join("\n");
}

function targetLabel(target) {
  if (!target) {
    return "未知文献";
  }
  const title = target.parentItem && target.parentItem.getField
    ? target.parentItem.getField("title")
    : "";
  if (title) {
    return title;
  }
  return target.pdfPath || (target.pdfAttachment && target.pdfAttachment.key) || "未知文献";
}

function itemLabel(item) {
  if (!item) {
    return "未知条目";
  }
  const title = item.getField ? item.getField("title") : "";
  if (title) {
    return title;
  }
  const path = item.getFilePath && item.getFilePath();
  return path || item.key || "未知条目";
}

function updateProgress(progress, message, state) {
  try {
    if (!progress) {
      return;
    }
    if (progress.closed) {
      return;
    }
    if (progress.detailEl) {
      progress.detailEl.textContent = String(message || "");
      progress.detailEl.style.color = state && state.failed ? "#991b1b" : "#1f2328";
      return;
    }
    if (progress.addDescription) {
      progress.addDescription(message);
    }
  }
  catch (e) {
    Zotero.logError(e);
  }
}

function closeProgress(progress, timeout) {
  try {
    if (!progress) {
      return;
    }
    if (progress.closeTimer !== undefined) {
      if (progress.closeTimer) {
        clearTimeout(progress.closeTimer);
      }
      progress.closeTimer = setTimeout(() => {
        if (progress.closed) {
          return;
        }
        if (progress.box && progress.box.parentNode) {
          progress.box.parentNode.removeChild(progress.box);
        }
        progress.closed = true;
      }, timeout || 4000);
      return;
    }
    if (progress.startCloseTimer) {
      progress.startCloseTimer(timeout || 4000);
    }
  }
  catch (e) {
    Zotero.logError(e);
  }
}


async function ensureDirectory(path) {
  try {
    await IOUtils.makeDirectory(path, { ignoreExisting: true });
  }
  catch (e) {
    Zotero.logError(e);
  }
}

async function ensurePythonShim(cacheRoot) {
  if (!Zotero.isWin || !fileExists("C:\\Windows\\py.exe")) {
    return;
  }
  const shimPath = cacheRoot + "\\python.cmd";
  const body = "@echo off\r\nC:\\Windows\\py.exe -3 %*\r\n";
  await IOUtils.writeUTF8(shimPath, body);
}

async function removeFileIgnoreMissing(path) {
  try {
    const file = Components.classes["@mozilla.org/file/local;1"]
      .createInstance(Ci.nsIFile);
    file.initWithPath(path);
    if (file.exists() && file.isFile()) {
      file.remove(false);
    }
  }
  catch (e) {
    Zotero.logError(e);
  }
}

function readTail(path) {
  try {
    const content = Zotero.File.getContents(path);
    if (!content) {
      return "日志为空。";
    }
    const lines = String(content).split(/\r?\n/).filter(Boolean);
    return "CLI 日志末尾：\n" + lines.slice(-12).join("\n");
  }
  catch (e) {
    return "无法读取 CLI 日志：" + readableError(e);
  }
}

function readLog(path) {
  try {
    return Zotero.File.getContents(path) || "";
  }
  catch (e) {
    Zotero.logError(e);
    return "";
  }
}

function extractReadingNoteFromLog(path) {
  return inspectCodexLog(path).noteBody;
}

function inspectCodexLog(path) {
  const log = readLog(path);
  const result = {
    noteBody: "",
    noteBlockCount: 0,
    rawNoteMarkerBlockCount: 0,
    noteMarkerWarning: false,
    transportWarning: false
  };
  if (!log) {
    return result;
  }
  const pattern = /(?:^|\r?\n)\s*::codex-zotero-note-start::\s*\r?\n([\s\S]*?)\r?\n\s*::codex-zotero-note-end::\s*(?=\r?\n|$)/g;
  let match;
  let note = "";
  while ((match = pattern.exec(log)) !== null) {
    result.rawNoteMarkerBlockCount += 1;
    const candidate = (match[1] || "").replace(/\r\n/g, "\n").trim();
    if (candidate && !/^<这里放完整 Markdown 阅读笔记/.test(candidate) && !/^<杩欓噷鏀惧畬鏁/.test(candidate)) {
      result.noteBlockCount += 1;
      note = candidate;
    }
  }
  if (note) {
    result.noteBody = note;
  }
  result.noteMarkerWarning = result.rawNoteMarkerBlockCount > 1 || result.noteBlockCount > 1;
  result.transportWarning = /failed to connect to websocket|Falling back from WebSockets|Reconnecting/i.test(log);
  return result;
}

function isMineruDownloadFailure(log) {
  return /Download failed|download failed|curl download failed|UNEXPECTED_EOF_WHILE_READING|completed without full_zip_url|SSL\/TLS|schannel|Connection reset|timed out|timeout/i.test(String(log || ""));
}

function lastNonEmptyLine(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function buildFailureMessage(context) {
  const log = readLog(context.logPath);
  const tail = readTail(context.logPath);
  const base = [
    "当前 CLI 配置：" + context.configuredCodexPath,
    "实际执行路径：" + context.codexPath,
    "日志文件：" + context.logPath
  ].join("\n");

  if (/You've hit your usage limit|usage limit/i.test(log)) {
    const reset = extractResetTime(log);
    return {
      title: "Codex 用量限制",
      message: [
        "Codex CLI 返回用量限制，阅读任务未继续。",
        reset ? "CLI 提示可重试时间：" + reset : "",
        "",
        "注意：Zotero 调用的是 standalone Codex CLI，可能与 Codex 桌面 App 显示的额度/登录态不完全一致。",
        "请检查 `codex login status`、Codex CLI 使用的账号，以及该模型/CLI 通道的额度。",
        "",
        base,
        "",
        tail,
        "",
        readableError(context.error)
      ].filter(Boolean).join("\n")
    };
  }

  if (/Not logged in|401 Unauthorized|Missing bearer|authentication/i.test(log)) {
    return {
      title: "Codex CLI 未登录或认证失效",
      message: [
        "Codex CLI 未登录或认证失效，阅读任务未继续。",
        "请在终端运行 `codex login status` 检查；如果显示 Not logged in，需要单独登录 standalone CLI。",
        "",
        base,
        "",
        tail,
        "",
        readableError(context.error)
      ].join("\n")
    };
  }

  if (/python.+CommandNotFoundException|python.+not recognized|无法将.*python.*识别/i.test(log)) {
    return {
      title: "Python 命令不可用",
      message: [
        "Codex 后台环境找不到 `python` 命令。",
        "新版插件已加入临时 python.cmd 兼容层；请确认正在使用最新 XPI 后重试。",
        "",
        base,
        "",
        tail,
        "",
        readableError(context.error)
      ].join("\n")
    };
  }

  if (/MinerU|mineru_precise_parse|MINERU/i.test(log) && /ERROR|failed|Traceback|Exit code: 1/i.test(log)) {
    return {
      title: "MinerU 解析失败",
      message: [
        "MinerU/PDF 解析阶段失败，未创建空附件。",
        "",
        base,
        "",
        tail,
        "",
        readableError(context.error)
      ].join("\n")
    };
  }

  if (/attach-linked-file|attachLinkedFile|Zotero.*挂回|ATTACH_LINKED_FILE_FAILED/i.test(log)) {
    return {
      title: "Zotero 挂回失败",
      message: [
        "阅读笔记可能已经生成，但挂回 Zotero 失败。",
        "",
        base,
        "",
        tail,
        "",
        readableError(context.error)
      ].join("\n")
    };
  }

  return {
    title: "阅读任务失败",
    message: [
      "Codex CLI 可执行，但阅读流程失败。",
      "",
      base,
      "",
      tail,
      "",
      "可在 Zotero 高级设置中修改 extensions.codexZoteroBridge.codexPath。",
      "",
      readableError(context.error)
    ].join("\n")
  };
}

function extractResetTime(log) {
  const match = String(log).match(/try again at ([^\r\n.]+(?:AM|PM)?)/i);
  return match ? match[1].trim() : "";
}

function quoteWindowsCommand(parts) {
  return parts.map((part) => {
    const value = String(part);
    if (!/[ \t\n\v"]/.test(value)) {
      return value;
    }
    return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, "$&$&") + '"';
  }).join(" ");
}

function quotePowerShellString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function quotePosixCommand(parts) {
  return parts.map((part) => {
    return "'" + String(part).replace(/'/g, "'\\''") + "'";
  }).join(" ");
}

function buildWindowsEnvPrefix(env) {
  const entries = Object.entries(env || {});
  if (!entries.length) {
    return "";
  }
  return entries.map(([key, value]) => {
    return "set \"" + key + "=" + normalizeEnvValue(value) + "\" && ";
  }).join("");
}

function normalizeEnvValue(value) {
  return String(value == null ? "" : value).replace(/[\s\u00A0]+$/g, "");
}

function buildWindowsShellCommand(command, args, inputPath, logPath, env) {
  return buildWindowsEnvPrefix(env) +
    quoteWindowsCommand([command].concat(args)) +
    " < " + quoteWindowsCommand([inputPath]) +
    " > " + quoteWindowsCommand([logPath]) + " 2>&1";
}

async function writeWindowsHiddenRunner(path, command) {
  const script = [
    "Set shell = CreateObject(\"WScript.Shell\")",
    "code = shell.Run(" + quoteVbsString("C:\\Windows\\System32\\cmd.exe /d /s /c " + command) + ", 0, True)",
    "WScript.Quit code",
    ""
  ].join("\r\n");
  await writeUtf16LeText(path, script);
}

function quoteVbsString(value) {
  return "\"" + String(value).replace(/"/g, "\"\"") + "\"";
}

async function writeUtf16LeText(path, text) {
  const value = String(text);
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = 0xFF;
  bytes[1] = 0xFE;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const offset = 2 + index * 2;
    bytes[offset] = code & 0xFF;
    bytes[offset + 1] = code >> 8;
  }
  await IOUtils.write(path, bytes);
}

function buildPosixEnvPrefix(env) {
  const entries = Object.entries(env || {});
  if (!entries.length) {
    return "";
  }
  return entries.map(([key, value]) => {
    return key + "=" + quotePosixCommand([value]) + " ";
  }).join("");
}

function getEnvironment(name) {
  try {
    return Services.env.get(name) || "";
  }
  catch (e) {
    Zotero.logError(e);
    return "";
  }
}

function normalizePath(path) {
  return String(path).replace(/\\/g, "/").toLowerCase();
}

function decodeMaybeUtf8Base64(encodedValue, plainValue) {
  if (!encodedValue) {
    return plainValue || "";
  }
  const binary = atob(String(encodedValue));
  const bytes = [];
  for (let index = 0; index < binary.length; index++) {
    bytes.push(binary.charCodeAt(index));
  }
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
  let escaped = "";
  for (const byte of bytes) {
    escaped += "%" + ("00" + byte.toString(16)).slice(-2);
  }
  return decodeURIComponent(escaped);
}

function readableError(e) {
  if (!e) {
    return "未知错误";
  }
  return String(e.message || e);
}

function jsonResponse(status, value) {
  return [status, "application/json; charset=utf-8", JSON.stringify(value)];
}

function install(data, reason) {}

async function startup(data, reason) {
  await CodexZoteroBridge.startup();
}

async function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  await CodexZoteroBridge.shutdown();
}

function uninstall(data, reason) {}
