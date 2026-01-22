import { StorageService } from './StorageService';

export class DownloadService {
  /**
   * 強化的 CSV 解析器：支援引號處理與標頭清理
   */
  private static parseCSV(csvText: string): any[] {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    // 1. 取得標頭並清理 (移除 BOM, 引號, 多餘空格)
    const rawHeaders = lines[0].replace(/^\uFEFF/, '').split(',');
    const headers = rawHeaders.map(h => h.trim().replace(/^["'](.*)["']$/, '$1'));
    
    // 2. 解析資料列
    return lines.slice(1).map(line => {
      const values = this.splitCSVLine(line);
      const obj: any = {};
      headers.forEach((header, i) => {
        let val = values[i] !== undefined ? values[i].trim() : '';
        val = val.replace(/^["'](.*)["']$/, '$1');
        obj[header] = val;
      });
      return obj;
    });
  }

  /**
   * 支援雙引號內包含逗號的分割邏輯
   */
  private static splitCSVLine(line: string): string[] {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  /**
   * 正規化題目資料，確保符合 App 內部的 Question 格式
   */
  private static normalizeQuestions(rawData: any[]): any[] {
    if (rawData.length === 0) return [];

    const keys = Object.keys(rawData[0]);
    const lk = (s: string) => s.toLowerCase();
    
    // 定義模糊匹配規則
    const findKey = (keywords: string[]) => 
      keys.find(k => keywords.some(kw => lk(k).includes(lk(kw))));

    // 取得實際的欄位映射
    const mapping = {
      Id: findKey(['id', '編號', '題號', '序號', 'no']) || 'Id',
      Type: findKey(['type', '類型', '題型', '種類']) || 'Type',
      Q: findKey(['題目', '內容', 'content', 'question', '題項', '描述']) || 'Q',
      A: findKey(['選項a', '選項1', 'ans_a', 'opt_a']) || keys.find(k => lk(k) === 'a') || 'A',
      B: findKey(['選項b', '選項2', 'ans_b', 'opt_b']) || keys.find(k => lk(k) === 'b') || 'B',
      C: findKey(['選項c', '選項3', 'ans_c', 'opt_c']) || keys.find(k => lk(k) === 'c') || 'C',
      D: findKey(['選項d', '選項4', 'ans_d', 'opt_d']) || keys.find(k => lk(k) === 'd') || 'D',
      E: findKey(['選項e', '選項5', 'ans_e', 'opt_e']) || keys.find(k => lk(k) === 'e') || 'E',
      Ans: findKey(['ans', '答案', '正確答案', '解答']) || 'Ans',
      Exp: findKey(['exp', '解析', '說明', '詳解', '備註']) || 'Exp'
    };

    return rawData.map((row, index) => {
      // 取得題型並統一過濾空白
      const type = (row[mapping.Type] || '選擇題').toString().trim();
      // 支援包含「是非」二字的判斷
      const isTrueFalse = type.includes('是非');

      // 答案正規化
      let rawAns = (row[mapping.Ans] || '').toString().trim().toUpperCase();
      let finalAns = rawAns;

      if (isTrueFalse) {
        // 是非題：只要是 A, 1, O, 正確, 或全形 Ｏ 均視為 A
        if (['O', 'Ｏ', '正確', '1', 'A'].some(k => rawAns.includes(k))) {
          finalAns = 'A';
        } else if (['X', 'Ｘ', '錯誤', '2', 'B'].some(k => rawAns.includes(k))) {
          finalAns = 'B';
        }
      } else {
        if (rawAns === '1') finalAns = 'A';
        else if (rawAns === '2') finalAns = 'B';
        else if (rawAns === '3') finalAns = 'C';
        else if (rawAns === '4') finalAns = 'D';
      }

      return {
        Id: (row[mapping.Id] || (index + 1)).toString(),
        Type: type,
        Q: (row[mapping.Q] || '').toString().trim(),
        // 是非題強制 A=O, B=X，並徹底清空 C, D, E 避免雜訊
        A: isTrueFalse ? 'O' : (row[mapping.A] || '').toString().trim(),
        B: isTrueFalse ? 'X' : (row[mapping.B] || '').toString().trim(),
        C: isTrueFalse ? '' : (row[mapping.C] || '').toString().trim(),
        D: isTrueFalse ? '' : (row[mapping.D] || '').toString().trim(),
        E: isTrueFalse ? '' : (row[mapping.E] || '').toString().trim(),
        Ans: finalAns,
        Exp: (row[mapping.Exp] || '').toString().trim()
      };
    });
  }

  static async fetchIndex(url: string): Promise<any[]> {
    try {
      const response = await fetch(url);
      const text = await response.text();
      return this.parseCSV(text).filter(item => item.IsActive === 'TRUE' || item.isActive === 'TRUE');
    } catch (e) {
      console.error('Failed to fetch index', e);
      throw e;
    }
  }

  static async downloadQuiz(item: any, onProgress?: (msg: string) => void): Promise<void> {
    // 取得更完整的元數據（確保欄位名稱匹配）
    const lk = (s: any) => (s || '').toString().toLowerCase();
    const findVal = (obj: any, keywords: string[]) => {
      const key = Object.keys(obj).find(k => keywords.some(kw => lk(k).includes(lk(kw))));
      return key ? obj[key] : undefined;
    };

    const displayName = findVal(item, ['displayname', '名稱', '標題']) || item.DisplayName || item.displayName;
    const category = findVal(item, ['category', '分類', '科目']) || item.Category || item.category;
    const description = findVal(item, ['description', '描述', '說明', '簡介']) || item.Description || item.description;
    const updateDate = findVal(item, ['updatedate', '更新日期', '日期']) || item.UpdateDate || item.updateDate;
    
    // 1. 取得原始網址並清理前後空格
    let jsonUrl = (findVal(item, ['jsonurl', 'url', 'json連結', '網址', 'jsonpath']) || '').toString().trim();
    const rawSheetId = (item.SheetId || '').toString().trim();
    
    // 2. 如果 SheetId 是完整網址，將其視為 jsonUrl
    if (rawSheetId.startsWith('http')) {
      jsonUrl = rawSheetId;
    }

    // 3. 處理 Google Drive 檔案連結，轉換為直接下載網址 (支援多種 Drive 網址格式)
    if (jsonUrl && (jsonUrl.includes('drive.google.com') || jsonUrl.includes('docs.google.com'))) {
      const driveIdMatch = jsonUrl.match(/\/(?:d|open|file\/d)\/([a-zA-Z0-9_-]+)/) || jsonUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (driveIdMatch && driveIdMatch[1]) {
        jsonUrl = `https://drive.google.com/uc?export=download&id=${driveIdMatch[1]}`;
      }
    }

    // 4. 自動處理 GitHub 網址，將 blob 連結轉換為 raw 連結
    if (jsonUrl && jsonUrl.includes('github.com') && jsonUrl.includes('/blob/')) {
      jsonUrl = jsonUrl
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }

    // 5. 針對 Web 環境 (localhost) 加入 CORS 代理 (解決 GitHub/Drive 在瀏覽器的限制)
    if (jsonUrl && typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
      console.log('Web environment detected, using CORS proxy for:', jsonUrl);
      jsonUrl = `https://corsproxy.io/?${encodeURIComponent(jsonUrl)}`;
    }

    const normalizedItem = {
      ...item,
      DisplayName: displayName,
      Category: category,
      Description: description,
      UpdateDate: updateDate
    };

    try {
      if (jsonUrl) {
        onProgress?.('正在下載 JSON 題庫...');
        console.log(`Final Fetch URL: ${jsonUrl}`);
        const response = await fetch(jsonUrl);
        if (!response.ok) {
          throw new Error(`下載失敗 (HTTP ${response.status})，請確認連結是否正確或檔案已公開`);
        }
        
        const data = await response.json();

        if (Array.isArray(data)) {
          // 模式 A: JSON 是一個題目陣列
          onProgress?.('正在處理題目資料...');
          const normalized = this.normalizeQuestions(data);
          await this.saveToStorage(normalizedItem, normalizedItem.Id, normalizedItem.DisplayName, normalized);
        } else if (data.quizzes && Array.isArray(data.quizzes)) {
          // 模式 B: JSON 包含多個題庫 (類似分頁模式)
          for (let i = 0; i < data.quizzes.length; i++) {
            const quiz = data.quizzes[i];
            const subName = quiz.name || `${normalizedItem.DisplayName}-${i + 1}`;
            onProgress?.(`處理中 (${i + 1}/${data.quizzes.length}): ${subName}`);
            const normalized = this.normalizeQuestions(quiz.questions || []);
            await this.saveToStorage(normalizedItem, `${normalizedItem.Id}_${i}`, subName, normalized);
          }
        } else if (data.questions && Array.isArray(data.questions)) {
          // 模式 C: JSON 物件包含 questions 欄位
          const normalized = this.normalizeQuestions(data.questions);
          await this.saveToStorage(normalizedItem, normalizedItem.Id, normalizedItem.DisplayName, normalized);
        }
        return;
      }

      // 如果不是網址，才走原本的 Google Sheets CSV 模式
      const baseUrl = `https://docs.google.com/spreadsheets/d/${rawSheetId}/export?format=csv`;
      onProgress?.('正在讀取分頁資訊...');
      const response = await fetch(`${baseUrl}&gid=0`);
      const text = await response.text();
      const firstPageData = this.parseCSV(text);

      if (firstPageData.length === 0) {
        onProgress?.('讀取失敗：內容為空');
        return;
      }

      const keys = Object.keys(firstPageData[0]);
      const gidKey = keys.find(k => k.toLowerCase().includes('gid'));
      const nameKey = keys.find(k => {
        const lk = k.toLowerCase();
        return lk.includes('名稱') || lk.includes('name') || lk.includes('章節') || lk.includes('科目') || lk.includes('標題');
      });

      if (!gidKey || !nameKey) {
        // 模式 A: 單一題庫
        onProgress?.('正在儲存題目資料...');
        const normalized = this.normalizeQuestions(firstPageData);
        await this.saveToStorage(normalizedItem, normalizedItem.Id, normalizedItem.DisplayName, normalized);
      } else {
        // 模式 B: 多分頁題庫
        for (let i = 0; i < firstPageData.length; i++) {
          const sub = firstPageData[i];
          const gid = sub[gidKey];
          const subName = sub[nameKey] || `${normalizedItem.DisplayName}-${i + 1}`;
          
          if (gid === undefined || gid === '') continue;

          onProgress?.(`下載中 (${i + 1}/${firstPageData.length}): ${subName}`);
          
          const subResponse = await fetch(`${baseUrl}&gid=${gid}`);
          const subText = await subResponse.text();
          const subQuestions = this.parseCSV(subText);

          // 正規化題目格式
          const normalized = this.normalizeQuestions(subQuestions);
          await this.saveToStorage(normalizedItem, `${normalizedItem.Id}_${gid}`, subName, normalized);
        }
      }
    } catch (e) {
      console.error(`Download failed: ${normalizedItem.DisplayName}`, e);
      throw e;
    }
  }

  private static async saveToStorage(parentItem: any, id: string, name: string, questions: any[]) {
    const fileInfo = {
      id: id,
      parentId: parentItem.Id || parentItem.id,
      displayName: name,
      parentDisplayName: parentItem.DisplayName || parentItem.displayName,
      category: parentItem.Category || parentItem.category,
      description: parentItem.Description || parentItem.description,
      fileName: `${id}.json`,
      isDownloaded: true,
      updateDate: parentItem.UpdateDate || parentItem.updateDate || new Date().toLocaleDateString()
    };
    await StorageService.saveDownloadedFile(fileInfo, questions);
  }
}
