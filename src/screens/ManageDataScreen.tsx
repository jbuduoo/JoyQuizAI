import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StorageService } from '../services/StorageService';
import { getQuestionData } from '../utils/questionLoader';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface QuestionGroupItem {
  id: string;
  title: string;
  fileName: string;
  isDownloaded: boolean;
}

interface QuestionGroupInfo {
  id: string; // 用 typeName 或 category 作為 ID
  displayName: string;
  category: string;
  description?: string;
  updateDate?: string;
  items: QuestionGroupItem[];
}

const ManageDataScreen = () => {
  const navigation = useNavigation();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [questionGroups, setQuestionGroups] = useState<QuestionGroupInfo[]>([]);

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      const questionsIndex = require('../../assets/data/questions/questions.json');
      let dynamicGroups: QuestionGroupInfo[] = [];

      // 1. 處理內置分組 (questionListFiles)
      if (questionsIndex.questionListFiles) {
        questionsIndex.questionListFiles.forEach((group: any) => {
          dynamicGroups.push({
            id: group.typeName,
            displayName: group.displayName || group.typeName,
            category: group.typeName,
            description: group.description,
            updateDate: group.updateDate,
            items: group.items.map((item: any) => ({
              id: item.series_no,
              title: item.displayName,
              fileName: item.file,
              isDownloaded: false
            }))
          });
        });
      }

      // 2. 處理內置單個檔案 (questionFiles) - 視為獨立分組
      if (questionsIndex.questionFiles) {
        questionsIndex.questionFiles.forEach((file: any) => {
          if (file.isQuestionFile) {
            dynamicGroups.push({
              id: `file_${file.id}`,
              displayName: file.displayName,
              category: '內置題庫',
              items: [{
                id: file.id,
                title: file.displayName,
                fileName: file.fileName,
                isDownloaded: false
              }]
            });
          }
        });
      }

      // 3. 處理下載的題庫 (歸併到分組)
      const downloadedFiles = await StorageService.getDownloadedFiles();
      downloadedFiles.forEach(file => {
        const groupId = file.category || '未分類';
        let group = dynamicGroups.find(g => g.id === groupId);
        
        const item = {
          id: file.id,
          title: file.displayName,
          fileName: file.fileName,
          isDownloaded: true
        };

        if (group) {
          if (!group.items.find(i => i.id === file.id)) {
            group.items.push(item);
          }
          if (file.parentDisplayName) group.displayName = file.parentDisplayName;
          if (file.description) group.description = file.description;
          if (file.updateDate) group.updateDate = file.updateDate;
        } else {
          dynamicGroups.push({
            id: groupId,
            displayName: file.parentDisplayName || groupId,
            category: groupId,
            description: file.description,
            updateDate: file.updateDate,
            items: [item]
          });
        }
      });

      setQuestionGroups(dynamicGroups);
    } catch (error) {
      console.error('Failed to load question groups', error);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBatchDelete = () => {
    if (selectedItems.size === 0) {
      const msg = '請至少選擇一個要刪除的題庫分組';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('提示', msg);
      }
      return;
    }

    const confirmMsg = `您已選擇 ${selectedItems.size} 個題庫分組。將刪除該組下所有單元的練習進度、最愛與錯題紀錄。此操作無法復原，確定要繼續嗎？`;

    const performDelete = async () => {
      try {
        const userAnswers = await StorageService.getUserAnswers();
        const progress = await StorageService.getProgress();
        const completed = await StorageService.getCompletedCategories();
        
        let updatedUserAnswers = { ...userAnswers };
        let updatedProgress = { ...progress };
        let updatedCompleted = { ...completed };

        for (const groupId of selectedItems) {
          const group = questionGroups.find(g => g.id === groupId);
          if (!group) continue;

          for (const item of group.items) {
            // 1. 獲取該單元的所有題目 ID 以清除答題紀錄
            try {
              const data = await getQuestionData(item.fileName);
              let questionIds: string[] = [];
              if (Array.isArray(data)) {
                questionIds = data.map((q: any) => q.id);
              } else if (data && data.questions) {
                questionIds = data.questions.map((q: any) => q.id);
              }
              
              questionIds.forEach(qId => {
                delete updatedUserAnswers[qId];
              });
            } catch (e) {
              console.error(`Failed to load data for ${item.fileName}`, e);
            }

            // 2. 清除練習進度
            delete updatedProgress[item.title];
            // 處理帶模式前綴的進度 (如 FAVORITE_..., WRONG_...)
            Object.keys(updatedProgress).forEach(key => {
              if (key.endsWith(`_${item.title}`)) {
                delete updatedProgress[key];
              }
            });

            // 3. 清除完成標記
            delete updatedCompleted[item.title];

            // 4. 若為下載項目，則移除檔案
            if (item.isDownloaded) {
              await StorageService.removeDownloadedFile(item.id, item.fileName);
            }
          }
        }

        // 儲存更新後的資料
        await AsyncStorage.setItem('@quiz:userAnswers', JSON.stringify(updatedUserAnswers));
        await AsyncStorage.setItem('@quiz:quizProgress', JSON.stringify(updatedProgress));
        await AsyncStorage.setItem('@quiz:completedCategories', JSON.stringify(updatedCompleted));

        const successMsg = '所選分組的數據已成功刪除';
        if (Platform.OS === 'web') {
          window.alert(successMsg);
        } else {
          Alert.alert('完成', successMsg);
        }
        setSelectedItems(new Set());
        loadGroups();
      } catch (e) {
        const errorMsg = '刪除失敗';
        if (Platform.OS === 'web') {
          window.alert(errorMsg);
        } else {
          Alert.alert('錯誤', errorMsg);
        }
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) {
        performDelete();
      }
    } else {
      Alert.alert(
        '確認執行',
        confirmMsg,
        [
          { text: '取消', style: 'cancel' },
          { 
            text: '確定刪除', 
            style: 'destructive',
            onPress: performDelete
          }
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.headerButtonText}>返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>數據管理</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.container}>
        <View style={styles.hintBox}>
          <Text style={styles.hintText}>請勾選您想要刪除的題庫分組，然後點擊下方的按鈕執行。</Text>
        </View>

        <View style={styles.section}>
          {questionGroups.map((group) => {
            const isSelected = selectedItems.has(group.id);
            return (
              <TouchableOpacity 
                key={group.id} 
                style={[styles.item, styles.groupItem]} 
                onPress={() => toggleSelect(group.id)}
                activeOpacity={0.7}
              >
                <View style={styles.itemContent}>
                  <Text style={styles.groupTitle}>{group.displayName}</Text>
                  <Text style={styles.groupMeta}>
                    分類: {group.category} {group.updateDate ? ` | 更新: ${group.updateDate}` : ''}
                  </Text>
                  {group.description && (
                    <Text style={styles.groupDesc} numberOfLines={1}>{group.description}</Text>
                  )}
                  <Text style={styles.unitCount}>包含 {group.items.length} 個練習單元</Text>
                </View>
                <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                  {isSelected && <Text style={styles.checkMark}>✓</Text>}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>注意：清除後的資料無法復原，包含練習進度與收藏紀錄。</Text>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity 
          style={[styles.deleteButton, selectedItems.size === 0 && styles.disabledButton]} 
          onPress={handleBatchDelete}
          disabled={selectedItems.size === 0}
        >
          <Text style={styles.deleteButtonText}>執行刪除 ({selectedItems.size})</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#007AFF' },
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: { 
    height: 50,
    backgroundColor: '#007AFF', 
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  headerButtonText: { color: '#fff', fontSize: 16 },
  backButton: { width: 60 },
  headerRight: { width: 60 },
  hintBox: {
    padding: 16,
    backgroundColor: '#E5E5EA',
  },
  hintText: {
    fontSize: 14,
    color: '#3A3A3C',
    lineHeight: 20,
  },
  section: {
    marginTop: 20,
  },
  item: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 0.5,
    borderColor: '#C6C6C8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  groupItem: {
    backgroundColor: '#FFFBE6', // 淡淡的黃色背景，呼應黃色標頭
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
    marginBottom: 8,
    borderTopWidth: 0.5,
  },
  itemContent: {
    flex: 1,
    marginRight: 12,
  },
  groupTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  groupMeta: {
    fontSize: 13,
    color: '#3A3A3C',
    marginBottom: 2,
  },
  groupDesc: {
    fontSize: 13,
    color: '#8E8E93',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  unitCount: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '500',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxSelected: {
    backgroundColor: '#007AFF',
  },
  checkMark: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    padding: 16,
    marginTop: 10,
    marginBottom: 100,
  },
  footerText: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    borderTopWidth: 1,
    borderColor: '#C6C6C8',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  disabledButton: {
    backgroundColor: '#FFBABA',
  }
});

export default ManageDataScreen;
