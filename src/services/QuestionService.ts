import { Question, QuestionType, QuestionFile } from '../types';

export class QuestionService {
  /**
   * 將原始 JSON 資料標準化為 Question 物件
   */
  static transformRawQuestion(raw: any, fileInfo: Partial<QuestionFile>): Question {
    const series_no = raw.series_no || fileInfo.series_no || 'default';
    const id = raw.id || `${series_no}_${raw.Id}`;
    
    const expParts = [
      raw.Exp || raw.exp || '',
      raw.Ex,
      raw.Va,
      raw.Dif
    ].filter(part => !!part && part.toString().trim() !== '');

    return {
      id,
      sub: raw.sub,
      level: raw.level,
      year: raw.year,
      type: raw.type || raw.Type,
      status: raw.status,
      src: raw.src,
      L1: raw.L1,
      L2: raw.L2,
      tags: raw.tags,
      Q: raw.Q || raw.content || '',
      A: raw.A,
      B: raw.B,
      C: raw.C,
      D: raw.D,
      E: raw.E,
      Ans: raw.Ans,
      has_img: raw.has_img,
      Exp: expParts.join('\n'),
      Ex: raw.Ex,
      Va: raw.Va,
      Dif: raw.Dif,
      testName: raw.testName || fileInfo.testName,
      subject: raw.subject || fileInfo.subject,
      series_no,
      questionNumber: parseInt(raw.Id || (raw.id ? raw.id.split('_').pop() : '0'), 10) || 0,
    };
  }

  /**
   * 根據檔名解析測驗資訊 (用於匯入功能)
   */
  static parseFileInfoFromPath(path: string): Partial<QuestionFile> {
    // 假設格式為: testName_subject_seriesNo.json
    const fileName = path.split('/').pop() || '';
    const parts = fileName.replace('.json', '').split('_');
    
    return {
      testName: parts[0] || '未分類',
      subject: parts[1] || '',
      series_no: parts[2] || '1',
    };
  }

  /**
   * 模擬從靜態資源加載題目 (實際環境需處理動態 require 或 fetch)
   */
  static async loadQuestionsFromStatic(rawData: any[], fileInfo: Partial<QuestionFile>): Promise<Question[]> {
    return rawData.map(raw => this.transformRawQuestion(raw, fileInfo));
  }
}

