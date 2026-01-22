import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { DownloadService } from '../services/DownloadService';
import { StorageService } from '../services/StorageService';

const INDEX_URL = 'https://docs.google.com/spreadsheets/d/1ZNoyVNc4kmHZ5piKo_xL_SZoXOQymsssUbKpCEB6JKQ/export?format=csv&gid=0';

const DownloadScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [indexData, setIndexData] = useState<any[]>([]);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [downloadQueue, setDownloadQueue] = useState<any[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');

  useEffect(() => {
    fetchIndex();
    loadDownloadedList();
  }, []);

  useEffect(() => {
    if (!currentId && downloadQueue.length > 0) {
      const nextItem = downloadQueue[0];
      processDownload(nextItem);
    }
  }, [downloadQueue, currentId]);

  const fetchIndex = async () => {
    setLoading(true);
    try {
      const data = await DownloadService.fetchIndex(INDEX_URL);
      setIndexData(data);
    } catch (e) {
      Alert.alert('錯誤', '無法獲取目錄，請檢查網路連線');
    } finally {
      setLoading(false);
    }
  };

  const loadDownloadedList = async () => {
    const downloaded = await StorageService.getDownloadedFiles();
    // 只要下載清單中任何一個 ID 是以 item.Id 開頭的，就視為該項目已下載
    // 或是精確匹配（單一題庫模式）
    setDownloadedIds(new Set(downloaded.map(f => f.parentId || f.id)));
  };

  const processDownload = async (item: any) => {
    setCurrentId(item.Id);
    setStatusMsg('準備下載...');
    try {
      await DownloadService.downloadQuiz(item, (msg) => setStatusMsg(msg));
      setDownloadedIds(prev => new Set([...prev, item.Id]));
    } catch (e) {
      Alert.alert('錯誤', `${item.DisplayName} 下載失敗`);
    } finally {
      setDownloadQueue(prev => prev.filter(q => q.Id !== item.Id));
      setCurrentId(null);
      setStatusMsg('');
    }
  };

  const handleDownload = (item: any) => {
    if (downloadQueue.some(q => q.Id === item.Id) || currentId === item.Id) return;
    setDownloadQueue(prev => [...prev, item]);
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
        <Text style={styles.headerTitle}>題庫下載</Text>
        <TouchableOpacity 
          style={styles.headerRight} 
          onPress={fetchIndex}
        >
          <Text style={styles.headerButtonText}>整理</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.container}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>讀取目錄中...</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {indexData.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>目前沒有可下載的題庫</Text>
              </View>
            ) : (
              indexData.map((item) => {
                const isDownloaded = downloadedIds.has(item.Id);
                const isDownloading = currentId === item.Id;
                const isQueued = downloadQueue.some(q => q.Id === item.Id);
                const isWaiting = isQueued && !isDownloading;

                return (
                  <View key={item.Id} style={styles.itemCard}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemTitle}>{item.DisplayName}</Text>
                      <Text style={styles.itemDetail}>
                        分類: {item.Category} | 更新: {item.UpdateDate}
                      </Text>
                      {item.Description ? (
                        <Text style={styles.itemDesc}>{item.Description}</Text>
                      ) : null}
                    </View>
                    
                    <View style={styles.actions}>
                      {isDownloaded ? (
                        <View style={styles.downloadedContainer}>
                          <Text style={styles.downloadedText}>已下載</Text>
                        </View>
                      ) : (
                        <View style={styles.downloadActionGroup}>
                          {(isDownloading || isWaiting) && (
                            <Text style={styles.statusMsgText}>
                              {isDownloading ? statusMsg : '排隊中...'}
                            </Text>
                          )}
                          <TouchableOpacity 
                            style={[styles.downloadButton, (isDownloading || isWaiting) && styles.disabledButton]}
                            onPress={() => handleDownload(item)}
                            disabled={isDownloading || isWaiting}
                          >
                            {(isDownloading || isWaiting) ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text style={styles.downloadButtonText}>下載</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}
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
  headerRight: { width: 60, alignItems: 'flex-end' },
  scrollContent: { padding: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  loadingText: { marginTop: 12, color: '#8E8E93' },
  emptyText: { color: '#8E8E93', fontSize: 16 },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  itemInfo: { flex: 1, marginRight: 12 },
  itemTitle: { fontSize: 18, fontWeight: 'bold', color: '#000', marginBottom: 4 },
  itemDetail: { fontSize: 13, color: '#8E8E93', marginBottom: 4 },
  itemDesc: { fontSize: 14, color: '#3A3A3C' },
  actions: { alignItems: 'flex-end', justifyContent: 'center' },
  downloadActionGroup: { alignItems: 'flex-end' },
  statusMsgText: { fontSize: 10, color: '#007AFF', marginBottom: 4, maxWidth: 100, textAlign: 'right' },
  downloadButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 70,
    alignItems: 'center',
  },
  downloadButtonText: { color: '#fff', fontWeight: 'bold' },
  downloadedContainer: { alignItems: 'center' },
  downloadedText: { color: '#34C759', fontWeight: 'bold', marginBottom: 4 },
  disabledButton: { backgroundColor: '#C7C7CC' },
});

export default DownloadScreen;
