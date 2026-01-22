//首頁

import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, useWindowDimensions, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { StorageService } from '../services/StorageService';
import { QuestionService } from '../services/QuestionService';
import { getQuestionData } from '../utils/questionLoader';
import { Question, ViewMode, QUIZ_CONFIGS } from '../types';
import AdBanner from '../components/AdBanner';

interface QuestionListItem {
  series_no: string;
  displayName: string;
  file: string;
  total?: number;
}

interface QuestionGroup {
  typeName: string;
  displayName?: string;
  category?: string;
  description?: string;
  updateDate?: string;
  items: QuestionListItem[];
}

interface Category {
  id: string;
  title: string;
  total: number;
  fileName?: string;
  favoriteCount?: number;
  wrongCount?: number;
}

const HomeScreen = () => {
  // 定義導航與螢幕狀態
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused(); // 監聽當前頁面是否處於焦點
  const { width } = useWindowDimensions();
  
  // 定義狀態 (State)
  const [progressMap, setProgressMap] = useState<Record<string, number>>({}); // 紀錄各題庫練習進度
  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>({}); // 紀錄已完成的題庫
  const [categories, setCategories] = useState<Category[]>([]); // 存放題庫分類清單
  const [questionGroups, setQuestionGroups] = useState<QuestionGroup[]>([]); // 存放分組題庫
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set()); // 紀錄展開的分組
  const [isQuestionListMode, setIsQuestionListMode] = useState(false); // 是否為分組模式
  const [headerTitle, setHeaderTitle] = useState('題庫練習'); // 標題文字
  const [isDelEnabled, setIsDelEnabled] = useState(true); // 是否啟用刪除功能

  // 回應式佈局 (RWD) 配置
  const isLargeScreen = width > 768;
  const contentWidth = isLargeScreen ? 800 : '100%';

  useEffect(() => {
    if (isFocused) {
      loadAllData();
    }
  }, [isFocused]);

  /**
   * 統一載入所有資料 (分類、進度、L1/L2)
   */
  const loadAllData = async () => {
    try {
      const questionsIndex = require('../../assets/data/questions/questions.json');
      const isListMode = questionsIndex.config?.isQuestionListFile === true;
      setIsQuestionListMode(isListMode);
      
      if (questionsIndex.config?.HomeScreenHeaderTitle) {
        setHeaderTitle(questionsIndex.config.HomeScreenHeaderTitle);
      }
      if (questionsIndex.config?.isDel !== undefined) {
        setIsDelEnabled(questionsIndex.config.isDel);
      }

      // 1. 取得所有需要的資料
      const [downloadedFiles, userAnswers, completed] = await Promise.all([
        StorageService.getDownloadedFiles(),
        StorageService.getUserAnswers(),
        StorageService.getCompletedCategories()
      ]);
      
      setCompletedMap(completed);
      const answersArray = Object.values(userAnswers);
      const dataCache: Record<string, any> = {}; // 快取讀取過的題目資料

      // 定義資料讀取小工具
      const getCachedData = async (file: string) => {
        if (dataCache[file]) return dataCache[file];
        try {
          const data = await getQuestionData(file);
          const questions = Array.isArray(data) ? data : (data?.questions || []);
          dataCache[file] = questions;
          return questions;
        } catch (e) {
          return [];
        }
      };

      let dynamicGroups: QuestionGroup[] = [];
      let dynamicCategories: Category[] = [];

      if (isListMode && questionsIndex.questionListFiles) {
        // 2a. 處理分組模式
        const groups = await Promise.all(questionsIndex.questionListFiles.map(async (group: any) => {
          const items = await Promise.all((group.items || []).map(async (item: any) => {
            const questions = await getCachedData(item.file);
            const firstQ = questions[0];
            return {
              series_no: item.series_no,
              displayName: firstQ?.L2 || item.displayName || '未命名項目',
              l1Name: firstQ?.L1,
              file: item.file,
              total: questions.length,
            };
          }));
          return {
            typeName: group.typeName,
            displayName: items.find(i => i.l1Name)?.l1Name || group.displayName || group.typeName,
            items: items,
          };
        }));
        dynamicGroups = groups;

        // 加入已下載檔案到分組
        downloadedFiles.forEach(async (file) => {
          const group = dynamicGroups.find(g => g.typeName === file.category);
          if (group && !group.items.find(i => i.series_no === file.id)) {
            group.items.push({
              series_no: file.id,
              displayName: file.displayName,
              file: file.fileName,
              total: 0,
            } as any);
          }
        });
      } else {
        // 2b. 處理單層模式
        dynamicCategories = await Promise.all(questionsIndex.questionFiles
          .filter((file: any) => file.isQuestionFile === true)
          .map(async (file: any) => {
            const questions = await getCachedData(file.fileName);
            return {
              id: file.id,
              title: questions[0]?.L2 || file.displayName,
              total: questions.length,
              fileName: file.fileName,
            };
          })
        );

        // 加入已下載檔案到分類
        for (const file of downloadedFiles) {
          if (!dynamicCategories.find(c => c.id === file.id)) {
            const questions = await getCachedData(file.fileName);
            dynamicCategories.push({
              id: file.id,
              title: questions[0]?.L2 || file.displayName,
              total: questions.length,
              fileName: file.fileName,
            });
          }
        }
      }

      // 3. 計算收藏與錯題數 (使用快取)
      let allQuestionIds = new Set<string>();
      const topicCounts: Record<string, { fav: number, wrong: number }> = {};
      const filesToProcess = isListMode 
        ? dynamicGroups.flatMap(g => g.items.map(i => ({ id: i.series_no, fileName: i.file })))
        : dynamicCategories.map(c => ({ id: c.id, fileName: c.fileName }));

      for (const file of filesToProcess) {
        if (!file.fileName) continue;
        const questions = await getCachedData(file.fileName);
        let fav = 0;
        let wrong = 0;
        questions.forEach((q: any) => {
          const qId = q.id || `${file.id}_${q.Id}`;
          allQuestionIds.add(qId);
          const ans = userAnswers[qId];
          if (ans) {
            if (ans.isFavorite) fav++;
            if (ans.wrongCount > 0 && !ans.isCorrect) wrong++;
          }
        });
        topicCounts[file.id] = { fav, wrong };
      }

      // 4. 更新進度與狀態
      const progress = await StorageService.getProgress();
      setProgressMap(progress);

      // 更新分組或分類中的數據
      if (isListMode) {
        dynamicGroups.forEach(g => {
          g.items.forEach(item => {
            const counts = topicCounts[item.series_no];
            if (counts) {
              (item as any).favoriteCount = counts.fav;
              (item as any).wrongCount = counts.wrong;
            }
          });
        });
        setQuestionGroups(dynamicGroups);
      } else {
        dynamicCategories.forEach(c => {
          const counts = topicCounts[c.id];
          if (counts) {
            c.favoriteCount = counts.fav;
            c.wrongCount = counts.wrong;
          }
        });
        setCategories(dynamicCategories);
      }
    } catch (error) {
      console.error("Failed to load all data:", error);
    }
  };

  /**
   * 啟動測驗 Session (Session Launcher)
   * 負責處理進入測驗前的資料準備、進度讀取與環境清理
   */
  const handleStartQuiz = async (category: Category, mode: ViewMode = ViewMode.QUIZ, groupItems?: QuestionListItem[]) => {
    let questions: Question[] = [];
    let viewMode = mode;
    const quizConfig = QUIZ_CONFIGS[viewMode];

    // 1. 題目準備階段
    if (viewMode === ViewMode.FAVORITE || viewMode === ViewMode.WRONG || viewMode === ViewMode.MOCK) {
      const filesToProcess = groupItems 
        ? groupItems.map(i => ({ displayName: i.displayName, id: i.series_no, fileName: i.file }))
        : (category.fileName ? [{ displayName: category.title, id: category.id, fileName: category.fileName }] : []);

      let allLoadedQuestions: Question[] = [];
      for (const file of filesToProcess) {
        if (file.fileName) {
          try {
            const rawData = await getQuestionData(file.fileName);
            const loaded = await QuestionService.loadQuestionsFromStatic(rawData, {
              testName: file.displayName,
              series_no: file.id
            });
            allLoadedQuestions = [...allLoadedQuestions, ...loaded];
          } catch (e) {}
        }
      }

      if (viewMode === ViewMode.MOCK) {
        questions = allLoadedQuestions.sort(() => Math.random() - 0.5).slice(0, 50);
      } else if (viewMode === ViewMode.WRONG) {
        const userAnswers = await StorageService.getUserAnswers();
        questions = allLoadedQuestions.filter(q => {
          const status = userAnswers[q.id];
          return status && (status.wrongCount > 0 && !status.isCorrect);
        });
      } else if (viewMode === ViewMode.FAVORITE) {
        const userAnswers = await StorageService.getUserAnswers();
        questions = allLoadedQuestions.filter(q => {
          const status = userAnswers[q.id];
          return status && status.isFavorite;
        });
      }
    } else if (category.fileName) {
      try {
        const rawData = await getQuestionData(category.fileName);
        questions = await QuestionService.loadQuestionsFromStatic(rawData, {
          testName: category.title,
          series_no: category.id
        });
      } catch (e) {
        console.error('Failed to load questions', e);
      }
    }

    // 2. 策略執行階段 (Session Initialization)
    const progressKey = viewMode === ViewMode.QUIZ ? category.title : `${viewMode}_${category.title}`;
    const currentProgress = progressMap[progressKey] || 0;

    // 決定是否為「全新開始」：(進度為0) 或是 (模式策略要求完成後清除)
    const isRestarting = currentProgress === 0;
    const shouldClearAnswers = (mode === ViewMode.QUIZ || quizConfig.clearOnFinish) && isRestarting;

    if (shouldClearAnswers) {
      // 若是主線測驗重新開始，清除「已完成」標記
      if (mode === ViewMode.QUIZ && completedMap[category.title]) {
        await StorageService.clearCategoryCompleted(category.title);
      }

      // 重置進度索引
      await StorageService.saveProgress(progressKey, 0);
      
      // 抹除作答紀錄痕跡，確保進入後是「空白」狀態
      if (questions.length > 0) {
        await StorageService.clearUserAnswers(questions.map(q => q.id));
      }
    }

    // 3. 導向階段
    navigation.navigate('Quiz', {
      questions,
      title: category.title,
      viewMode,
      startIndex: quizConfig.saveProgress ? (progressMap[progressKey] || 0) : 0
    });
  };

  const toggleGroup = (typeName: string) => {
    setExpandedGroups(prev => {
      if (prev.has(typeName)) {
        return new Set();
      }
      return new Set([typeName]);
    });
  };

  const renderCategoryCard = (category: Category) => {
    const progressKey = category.title;
    const currentProgress = progressMap[progressKey] || 0;
    const isCompleted = completedMap[category.title] === true;
    const displayProgress = (isCompleted && currentProgress === 0) ? category.total : currentProgress;
    const hasProgress = currentProgress > 0;
    const progressPercent = category.total > 0 ? (displayProgress / category.total) * 100 : 0;

    return (
      <View key={category.id} style={styles.categoryContainer}>
        <View 
          style={[styles.card, isLargeScreen && styles.cardLarge]} 
        >
          <View style={styles.cardLeft}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {category.title}
            </Text>
            <Text style={styles.cardProgressText}>
              完成 {displayProgress}/{category.total} 題
            </Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
            </View>
          </View>

          <View style={styles.buttonGroup}>
            {isCompleted && (
              <TouchableOpacity 
                style={[styles.reviewButton, isLargeScreen && styles.quizButtonLarge]}
                onPress={() => handleStartQuiz(category, ViewMode.REVIEW)}
              >
                <Text style={[styles.quizButtonText, isLargeScreen && styles.quizButtonTextLarge]}>
                  {'檢\n視'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity 
              style={[
                styles.quizButton, 
                isLargeScreen && styles.quizButtonLarge
              ]}
              onPress={() => handleStartQuiz(category, ViewMode.QUIZ)}
            >
              <Text style={[styles.quizButtonText, isLargeScreen && styles.quizButtonTextLarge]}>
                {isCompleted ? '重新\n測驗' : (hasProgress ? '繼續\n測驗' : '開始\n測驗')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const renderGroup = (group: QuestionGroup) => {
    const isExpanded = expandedGroups.has(group.typeName);
    const groupFavCount = group.items.reduce((sum, item) => sum + ((item as any).favoriteCount || 0), 0);
    const groupWrongCount = group.items.reduce((sum, item) => sum + ((item as any).wrongCount || 0), 0);

    const renderGroupSubOption = (id: 'favorite' | 'wrong' | 'mock', title: string, count: number) => {
      const isDisabled = (id === 'favorite' || id === 'wrong') && count === 0;
      const mode = id === 'favorite' ? ViewMode.FAVORITE : (id === 'wrong' ? ViewMode.WRONG : ViewMode.MOCK);
      
      return (
        <View key={`${group.typeName}_${id}`} style={styles.subOptionRow}>
          <View style={styles.cardLeft}>
            <Text style={[styles.subOptionTitle, isDisabled && { color: '#8E8E93' }]}>
              {title}{id !== 'mock' ? `(${count})` : ''}
            </Text>
            <Text style={styles.subOptionDescription}>
              {id === 'favorite' && '練習您收藏的題目'}
              {id === 'wrong' && '針對答錯的題目進行複習'}
              {id === 'mock' && '隨機挑選 50 題進行模擬測試'}
            </Text>
          </View>
          <TouchableOpacity 
            style={[
              styles.quizButton, 
              isLargeScreen && styles.quizButtonLarge, 
              { backgroundColor: '#FF9500' },
              isDisabled && styles.disabledButton
            ]}
            onPress={() => handleStartQuiz({ id: group.typeName, title: group.displayName || group.typeName, total: 0 }, mode, group.items)}
            disabled={isDisabled}
          >
            <Text style={[styles.quizButtonText, isLargeScreen && styles.quizButtonTextLarge]}>
              開始{"\n"}測驗
            </Text>
          </TouchableOpacity>
        </View>
      );
    };

    return (
      <View key={group.typeName} style={styles.groupContainer}>
        <TouchableOpacity 
          style={styles.groupHeader} 
          onPress={() => toggleGroup(group.typeName)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.groupTitle}>{group.displayName || group.typeName}</Text>
            <View style={{ marginTop: 4 }}>
              <Text style={styles.groupSubtitle}>
                分類: {group.category || group.typeName}{group.updateDate ? ` | 更新: ${group.updateDate}` : ''}
              </Text>
              {group.description ? (
                <Text style={styles.groupDescription}>{group.description}</Text>
              ) : null}
            </View>
          </View>
          <Text style={styles.groupIcon}>{isExpanded ? '▼' : '▶'}</Text>
        </TouchableOpacity>
        {isExpanded && (
          <View style={styles.groupItems}>
            {group.items.map(item => renderCategoryCard({
              id: item.series_no,
              title: item.displayName,
              total: item.total || 0,
              fileName: item.file,
              favoriteCount: (item as any).favoriteCount,
              wrongCount: (item as any).wrongCount
            }))}
            <View style={styles.subOptionsFooter}>
              {renderGroupSubOption('favorite', '最愛練習', groupFavCount)}
              {renderGroupSubOption('wrong', '錯題複習', groupWrongCount)}
              {renderGroupSubOption('mock', '模擬測驗', 50)}
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity 
            onPress={() => navigation.navigate('Download')}
            style={{ marginRight: 12 }}
          >
            <Text style={styles.settingsButtonText}>下載</Text>
          </TouchableOpacity>
          {isDelEnabled && (
            <>
              <TouchableOpacity 
                onPress={() => navigation.navigate('DataManagement')}
                style={{ marginRight: 12 }}
              >
                <Text style={styles.settingsButtonText}>刪除</Text>
              </TouchableOpacity>
              {Platform.OS === 'web' && (
                <TouchableOpacity 
                  onPress={async () => {
                    const files = await StorageService.getDownloadedFiles();
                    let allData: any = { list: files, content: {} };
                    for (const f of files) {
                      allData.content[f.fileName] = await StorageService.getExternalQuestionData(f.fileName);
                    }
                    const debugStr = JSON.stringify(allData, null, 2);
                    if (Platform.OS === 'web') {
                      console.log('JOYQUIZ_DEBUG_DATA:', allData);
                      window.alert('資料已輸出至 Console 控制台，請按 F12 查看' );
                    } else {
                      Alert.alert('原始資料 (Console 同步輸出)', debugStr.substring(0, 500) + '...');
                      console.log('JOYQUIZ_DEBUG_DATA:', allData);
                    }
                  }}
                >
                  <Text style={styles.settingsButtonText}>查看</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <TouchableOpacity 
          style={styles.headerRight} 
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.settingsButtonText}>設定</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.container}>
        <ScrollView 
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
        >
          {isQuestionListMode ? (
            <>
              {questionGroups.map(renderGroup)}
              {categories.map(renderCategoryCard)}
            </>
          ) : (
            categories.map(renderCategoryCard)
          )}
        </ScrollView>
        <AdBanner />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#007AFF' },
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  scrollContent: { paddingVertical: 8, flexGrow: 1 },
  groupContainer: {
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFF8DC',
    borderLeftWidth: 5,
    borderLeftColor: '#00BFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  groupTitle: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#000',
  },
  groupSubtitle: {
    fontSize: 13,
    color: '#000',
    marginBottom: 2,
  },
  groupDescription: {
    fontSize: 13,
    color: '#000',
    fontStyle: 'italic',
  },
  groupIcon: {
    fontSize: 16,
    color: '#00BFFF',
  },
  groupItems: {
    backgroundColor: '#fff',
    paddingLeft: 0,
  },
  header: { 
    height: Platform.OS === 'web' ? 60 : 50,
    backgroundColor: '#007AFF', 
    flexDirection: 'row',
    justifyContent: 'space-between', 
    alignItems: 'center',
    paddingHorizontal: 16,
    elevation: 4,
    ...(Platform.OS === 'web' 
      ? { boxShadow: '0px 1px 2px rgba(0,0,0,0.1)' } 
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.1,
          shadowRadius: 2,
        }
    ),
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 100,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  settingsButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  headerTitle: { 
    fontSize: 22, 
    fontWeight: 'bold', 
    color: '#fff',
    letterSpacing: 1,
  },
  card: { 
    backgroundColor: '#fff', 
    flexDirection: 'row',
    borderRadius: 0, 
    padding: 12,
    marginBottom: 0,
    alignItems: 'center',
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  cardLarge: {
    padding: 16, 
  },
  cardLeft: { flex: 1, marginRight: 8 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#000', marginBottom: 4 },
  categoryContainer: {
    backgroundColor: '#fff',
  },
  subOptionsContainer: {
    backgroundColor: '#fff',
    paddingLeft: 16,
  },
  subOptionsFooter: {
    backgroundColor: '#fff',
    paddingLeft: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  subOptionsHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    marginTop: 16,
    marginBottom: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  subOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  subOptionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#3A3A3C',
    marginBottom: 2,
  },
  subOptionDescription: {
    fontSize: 12,
    color: '#8E8E93',
  },
  cardProgressText: { fontSize: 13, color: '#8E8E93', marginBottom: 4 },
  progressBarTrack: { 
    height: 4, 
    backgroundColor: '#E5E5EA', 
    borderRadius: 2,
    overflow: 'hidden'
  },
  progressBarFill: { 
    height: '100%', 
    backgroundColor: '#007AFF' 
  },
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewButton: {
    backgroundColor: '#FF9500', 
    borderRadius: 6, 
    paddingVertical: 6,
    paddingHorizontal: 8,
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  quizButton: { 
    backgroundColor: '#007AFF', 
    borderRadius: 6, 
    paddingVertical: 6,
    paddingHorizontal: 8,
    width: 60,
    alignItems: 'center',
    justifyContent: 'center'
  },
  quizButtonLarge: {
    width: 100, 
    height: 50,  
    borderRadius: 8,
  },
  quizButtonText: { 
    color: '#fff', 
    fontSize: 14, 
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 18,
  },
  quizButtonTextLarge: {
    fontSize: 18, 
    lineHeight: 22,
  },
  disabledButton: {
    backgroundColor: '#C7C7CC',
  },
});

export default HomeScreen;

