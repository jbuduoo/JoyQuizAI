import { StorageService } from '../services/StorageService';

/**
 * 取得題庫資料 (優先從內置資源讀取，若無則從外部儲存讀取)
 */
export const getQuestionData = async (fileName: string) => {
  const staticData = getStaticQuestionData(fileName);
  if (staticData && (Array.isArray(staticData) ? staticData.length > 0 : !!staticData)) {
    return staticData;
  }

  // 若內置資源無此檔案，則嘗試從本地儲存讀取 (下載的題庫)
  return await StorageService.getExternalQuestionData(fileName);
};

/**
 * 獲取內置靜態題庫資源
 */
const getStaticQuestionData = (fileName: string) => {
  switch (fileName) {
    // 已關閉內置 sample.json，改用下載資料
    default:
      return null;
  }
};
