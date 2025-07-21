// hajime020828/alpha-final/Alpha-Final-4cbe9bf4da536211eff750877a9a976d273d2b03/pages/projects/[projectID].tsx
import { useRouter } from 'next/router';
import { useEffect, useState, useMemo, useCallback } from 'react';
import type { StockRecord, ProjectWithProgress, ProjectDetailApiResponse } from '@/lib/db';
import { Chart } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface FutureScenario {
  days: number;
  description: string;
  sharesPerDay: number | null;
  finalBenchmark: number | null;
  finalPL: number | null;
  finalPLBps: number | null;
  priceVsBenchmarkPct: number | null;
}

interface FixedVolumeScenario {
  day: number;
  totalSharesTraded: number;
  finalBenchmark: number | null;
  finalPL: number | null;
  finalPLBps: number | null;
  priceVsBenchmarkPct: number | null;
}

interface FinalMetrics {
    pl: number | null;
    performanceFee: number | null;
    fixedFee: number | null;
    plBps: number | null;
}


const ProjectDetailPage = () => {
  const router = useRouter();
  const { projectID } = router.query;
  const [data, setData] = useState<ProjectDetailApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [finalMetrics, setFinalMetrics] = useState<FinalMetrics | null>(null);

  const [simInputPrice, setSimInputPrice] = useState<string>('');
  const [simInputShares, setSimInputShares] = useState<string>('');
  const [simInputDays, setSimInputDays] = useState<string>('1');
  
  const [futureScenarios, setFutureScenarios] = useState<FutureScenario[]>([]);
  const [fixedVolumeScenarios, setFixedVolumeScenarios] = useState<FixedVolumeScenario[]>([]);
  const simulatedDateLabel = "シミュレーション";

  const [isHistoryVisible, setIsHistoryVisible] = useState<boolean>(true);

  useEffect(() => {
    if (projectID && typeof projectID === 'string') {
      const fetchProjectDetails = async () => {
        setLoading(true); 
        try {
          const res = await fetch(`/api/projects/${projectID}`);
          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            if (res.status === 404) throw new Error('Project not found');
            throw new Error(`API request failed with status ${res.status}: ${errorData.message || res.statusText}`);
          }
          const fetchedData: ProjectDetailApiResponse = await res.json();
          setData(fetchedData);
          setFinalMetrics({
            pl: fetchedData.finalPL,
            performanceFee: fetchedData.finalPerformanceFee,
            fixedFee: fetchedData.finalFixedFee,
            plBps: fetchedData.finalPLBps,
          });
          setError(null);
        } catch (e: any) {
          setError(e.message || 'Failed to fetch project details');
          console.error(e);
        } finally {
          setLoading(false);
        }
      };
      fetchProjectDetails();
    } else if (router.isReady && !projectID) {
        setLoading(false);
        setError("Project ID is missing in the URL.");
    }
  }, [projectID, router.isReady]);

  useEffect(() => {
    if (data?.project) {
        if (data.stockRecords && data.stockRecords.length > 0) {
            const lastRecord = data.stockRecords[data.stockRecords.length - 1];
            setSimInputPrice(prev => prev || (lastRecord?.FilledAveragePrice?.toString() ?? ''));
            setSimInputShares(prev => prev || (lastRecord?.FilledQty?.toString() ?? ''));
        } else {
            setSimInputPrice(prev => prev || '');
            setSimInputShares(prev => prev || '');
        }
    }
  }, [data]);

  const formatNumber = (value: number | null | undefined, fracDigits = 2, defaultVal: string = 'N/A') => {
    if (value === null || value === undefined) return defaultVal;
    if (fracDigits === 0) return Math.round(value).toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return value.toLocaleString('ja-JP', { minimumFractionDigits: fracDigits, maximumFractionDigits: fracDigits });
  };
  
  const formatCurrency = (value: number | null | undefined, defaultVal: string = 'N/A') => {
    if (value === null || value === undefined) return defaultVal;
    return value.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const calculatePLInBasisPoints = useCallback((pl: number | null, benchmark: number | null, totalShares: number | null): number | null => {
    if (pl === null || benchmark === null || totalShares === null || benchmark === 0 || totalShares === 0) return null;
    return (pl / (benchmark * totalShares)) * 10000;
  }, []);

  const calculatePriceVsBenchmarkPct = useCallback((price: number | null, benchmark: number | null): number | null => {
    if (price === null || benchmark === null || benchmark === 0) return null;
    return ((price / benchmark) - 1) * 100;
  }, []);

  const calculateFutureScenario = useCallback((
    baseProjectData: ProjectWithProgress,
    historicalDailyVwaps: (number | null)[],
    futurePrice: number,
    futureSharesLeft: number,
    futureDaysTarget: number
  ): FutureScenario | null => {
    if (!baseProjectData || futurePrice <= 0 || futureSharesLeft <= 0 || futureDaysTarget <= 0) {
      return null;
    }
    const validHistoricalVwaps = historicalDailyVwaps.filter(vwap => vwap !== null) as number[];
    let scenarioVwaps = [...validHistoricalVwaps];
    let scenarioCumulativeShares = baseProjectData.totalFilledQty || 0;
    let scenarioCumulativeAmount = baseProjectData.totalFilledAmount || 0;
    const sharesPerDay = Math.ceil(futureSharesLeft / futureDaysTarget);
    let sharesRemainingForScenario = futureSharesLeft;

    for (let i = 0; i < futureDaysTarget; i++) {
      const sharesForThisDay = Math.min(sharesPerDay, sharesRemainingForScenario);
      if (sharesForThisDay <= 0) break;
      scenarioCumulativeShares += sharesForThisDay;
      scenarioCumulativeAmount += futurePrice * sharesForThisDay;
      scenarioVwaps.push(futurePrice);
      sharesRemainingForScenario -= sharesForThisDay;
    }
    
    const finalBenchmark = scenarioVwaps.length > 0 
        ? scenarioVwaps.reduce((sum, vwap) => sum + vwap, 0) / scenarioVwaps.length
        : futurePrice; 
    let finalPL = 0;
    if (baseProjectData.Side === 'SELL') {
        finalPL = scenarioCumulativeAmount - (finalBenchmark * scenarioCumulativeShares);
    } else { 
        finalPL = (finalBenchmark * scenarioCumulativeShares) - scenarioCumulativeAmount;
    }
    const finalPLBps = calculatePLInBasisPoints(finalPL, finalBenchmark, scenarioCumulativeShares);
    const priceVsBenchmarkPct = calculatePriceVsBenchmarkPct(futurePrice, finalBenchmark);
    return {
      days: futureDaysTarget, description: `${futureDaysTarget}日で終了`, sharesPerDay: sharesPerDay,
      finalBenchmark: finalBenchmark, finalPL: finalPL, finalPLBps: finalPLBps, priceVsBenchmarkPct: priceVsBenchmarkPct,
    };
  }, [calculatePLInBasisPoints, calculatePriceVsBenchmarkPct]);
  
  const calculateFixedVolumeScenario = useCallback((
    baseProjectData: ProjectWithProgress,
    historicalDailyVwaps: (number | null)[],
    futurePrice: number,
    dailySharesToTrade: number,
    numberOfDays: number
  ): FixedVolumeScenario | null => {
      if (!baseProjectData || futurePrice <= 0 || dailySharesToTrade <= 0 || numberOfDays <= 0) {
          return null;
      }
      const validHistoricalVwaps = historicalDailyVwaps.filter(vwap => vwap !== null) as number[];
      let scenarioVwaps = [...validHistoricalVwaps];
      let scenarioCumulativeShares = baseProjectData.totalFilledQty || 0;
      let scenarioCumulativeAmount = baseProjectData.totalFilledAmount || 0;
  
      for (let i = 0; i < numberOfDays; i++) {
          scenarioCumulativeShares += dailySharesToTrade;
          scenarioCumulativeAmount += futurePrice * dailySharesToTrade;
          scenarioVwaps.push(futurePrice);
      }
      
      const finalBenchmark = scenarioVwaps.length > 0 
          ? scenarioVwaps.reduce((sum, vwap) => sum + vwap, 0) / scenarioVwaps.length
          : futurePrice; 
      
      let finalPL = 0;
      if (baseProjectData.Side === 'SELL') {
          finalPL = scenarioCumulativeAmount - (finalBenchmark * scenarioCumulativeShares);
      } else { 
          finalPL = (finalBenchmark * scenarioCumulativeShares) - scenarioCumulativeAmount;
      }
      
      const finalPLBps = calculatePLInBasisPoints(finalPL, finalBenchmark, scenarioCumulativeShares);
      const priceVsBenchmarkPct = calculatePriceVsBenchmarkPct(futurePrice, finalBenchmark);
      
      return {
        day: numberOfDays,
        totalSharesTraded: scenarioCumulativeShares,
        finalBenchmark,
        finalPL,
        finalPLBps,
        priceVsBenchmarkPct,
      };
  }, [calculatePLInBasisPoints, calculatePriceVsBenchmarkPct]);


  useEffect(() => {
    const numFuturePrice = parseFloat(simInputPrice);
    const numSimShares = parseFloat(simInputShares);
    const numMaxDays = parseInt(simInputDays, 10);

    if (data?.project && data.stockRecords &&
        !isNaN(numFuturePrice) && numFuturePrice > 0 &&
        !isNaN(numSimShares) && numSimShares > 0 &&
        !isNaN(numMaxDays) && numMaxDays > 0) {
        
        const historicalDailyVwaps = data.stockRecords.map(r => r.ALL_DAY_VWAP);

        const newFutureScenarios: FutureScenario[] = [];
        for (let d = 1; d <= numMaxDays; d++) {
            const scenario = calculateFutureScenario(data.project, historicalDailyVwaps, numFuturePrice, numSimShares, d);
            if (scenario) newFutureScenarios.push(scenario);
        }
        setFutureScenarios(newFutureScenarios);
        
        const newFixedVolumeScenarios: FixedVolumeScenario[] = [];
        for (let d = 1; d <= numMaxDays; d++) {
            const scenario = calculateFixedVolumeScenario(data.project, historicalDailyVwaps, numFuturePrice, numSimShares, d);
            if(scenario) newFixedVolumeScenarios.push(scenario);
        }
        setFixedVolumeScenarios(newFixedVolumeScenarios);

    } else {
      setFutureScenarios([]);
      setFixedVolumeScenarios([]);
    }
  }, [simInputPrice, simInputShares, simInputDays, data, calculateFutureScenario, calculateFixedVolumeScenario]);
  
  const finalChartData = useMemo(() => {
    if (!data) return null;
    
    const currentProject = data?.project;
    const currentStockRecords = data?.stockRecords || [];
    const numPriceForChart = simInputPrice !== '' && !isNaN(parseFloat(simInputPrice)) ? parseFloat(simInputPrice) : null;
    const numSharesForChart = simInputShares !== '' && !isNaN(parseFloat(simInputShares)) ? parseFloat(simInputShares) : null;

    const baseLabels = currentStockRecords.map(record => record.Date);
    const baseAvgPriceData = currentStockRecords.map(record => record.FilledAveragePrice);
    const baseDailyVwapData = currentStockRecords.map(record => record.ALL_DAY_VWAP);
    const baseBenchmarkTrendData = currentStockRecords.map(record => record.cumulativeBenchmarkVWAP);
    const baseQtyData = currentStockRecords.map(record => record.FilledQty);
    let chartLabels = [...baseLabels];
    let chartAvgPriceData: (number | null)[] = [...baseAvgPriceData];
    let chartDailyVwapData: (number | null)[] = [...baseDailyVwapData];
    let chartBenchmarkTrendData: (number | null)[] = [...baseBenchmarkTrendData];
    let chartQtyData: (number | null)[] = [...baseQtyData];

    if (numPriceForChart !== null || (numSharesForChart !== null && numSharesForChart !== 0) ) {
        if(chartLabels.indexOf(simulatedDateLabel) === -1) {
            chartLabels.push(simulatedDateLabel);
        }
        chartAvgPriceData.push(numPriceForChart); 
        chartDailyVwapData.push(numPriceForChart); 
        let benchmarkForSimulatedPoint: number | null = null;
        if (currentProject && numPriceForChart !== null) { 
            if (currentStockRecords.length > 0) {
                const histSum = (currentProject.benchmarkVWAP || 0) * (currentProject.tradedDaysCount || 0);
                const histCount = currentProject.tradedDaysCount || 0;
                benchmarkForSimulatedPoint = (histCount + 1 > 0) ? (histSum + numPriceForChart) / (histCount + 1) : numPriceForChart;
            } else {
                benchmarkForSimulatedPoint = numPriceForChart;
            }
        }
        chartBenchmarkTrendData.push(benchmarkForSimulatedPoint);
        chartQtyData.push(numSharesForChart); 
    }
    if (chartLabels.length === 0) return null;
    
    const toChartableData = (arr: (number | null)[]): number[] => arr.map(p => p === null ? NaN : p);
    return {
      labels: chartLabels,
      datasets: [
        { type: 'line' as const, label: '約定平均価格', data: toChartableData(chartAvgPriceData), borderColor: 'rgb(255, 99, 132)', backgroundColor: 'rgba(255, 99, 132, 0.2)', yAxisID: 'yPrice', tension: 0.1, pointRadius: 3 },
        { type: 'line' as const, label: '当日VWAP', data: toChartableData(chartDailyVwapData), borderColor: 'rgb(54, 162, 235)', backgroundColor: 'rgba(54, 162, 235, 0.2)', yAxisID: 'yPrice', tension: 0.1, pointRadius: 3 },
        { type: 'line' as const, label: 'ベンチマーク推移', data: toChartableData(chartBenchmarkTrendData), borderColor: 'rgb(75, 192, 192)', backgroundColor: 'rgba(75, 192, 192, 0.2)', yAxisID: 'yPrice', tension: 0.1, pointRadius: 3 },
        { type: 'bar' as const, label: '約定数量', data: toChartableData(chartQtyData), backgroundColor: 'rgba(153, 102, 255, 0.6)', borderColor: 'rgb(153, 102, 255)', yAxisID: 'yQuantity', order: 10 },
      ],
    };
  }, [data?.project, data?.stockRecords, simInputPrice, simInputShares, simulatedDateLabel]);

  const chartOptions: any = { 
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 20, bottom: 0, left: 10, right: 20 }},
    plugins: {
      legend: { 
        position: 'top' as const,
        labels: {
          boxWidth: 30,
          boxHeight: 2,
          padding: 10,
          font: {
            size: 11,
          }
        }
      },
      title: { display: true, text: '価格・VWAP・ベンチマーク推移と約定数量', font: { size: 16 }, padding: { bottom: 20 } },
      tooltip: { mode: 'index' as const, intersect: false, },
    },
    scales: {
      x: { 
        title: { 
          display: true, 
          text: '日付',
          padding: { top: 10, bottom: 0 }
        } 
      },
      yPrice: { 
        type: 'linear' as const, display: true, position: 'left' as const, title: { display: true, text: '価格' },
        grid: { drawOnChartArea: true },
        ticks: { callback: function(value: string | number) { return typeof value === 'number' ? formatNumber(value, 0) : value; } },
        grace: '5%',
        beginAtZero: false,
      },
      yQuantity: { 
        type: 'linear' as const, display: true, position: 'right' as const, title: { display: true, text: '約定数量 (株)' },
        grid: { drawOnChartArea: false },
        ticks: { callback: function(value: string | number) { return typeof value === 'number' ? formatNumber(value, 0) : value; } },
        min: 0, grace: '10%',
      },
    },
    interaction: { mode: 'index' as const, axis: 'x' as const, intersect: false }
  };


  if (loading && !data) return <p className="text-center text-gray-500">プロジェクト詳細を読み込み中...</p>;
  if (error) return <p className="text-center text-red-500">エラー: {error}</p>;
  if (!data || !data.project) return <p className="text-center text-gray-500">プロジェクトデータが見つかりません。</p>;

  const { project, stockRecords } = data;
  
  let displayTotalShares: number | null | undefined = project.Total_Shares;
  let displayTotalAmount: number | null | undefined = project.Total_Amount;
  
  const displayStockRecords = [...stockRecords].reverse(); 

  const tradedDays = project.tradedDaysCount || 0;
  let remainingBusinessDays: number | null = null;
  if (typeof project.Business_Days === 'number') remainingBusinessDays = project.Business_Days - tradedDays;
  
  let effectiveRemainingTargetShares: number | null = null;
  let sharesCalcStatusMessage: string | null = null;
  let remainingAmount: number | null = null;
  
  if (project.Total_Shares !== null && project.Total_Shares > 0) {
      effectiveRemainingTargetShares = Math.max(0, project.Total_Shares - (project.totalFilledQty || 0));
  } 
  else if (project.Total_Amount !== null && project.Total_Amount > 0) {
      remainingAmount = Math.max(0, project.Total_Amount - (project.totalFilledAmount || 0));
      sharesCalcStatusMessage = '金額ベース';
  }
  else {
      if ((project.totalFilledQty || 0) > 0 || (project.totalFilledAmount || 0) > 0 || project.Total_Shares === 0 || project.Total_Amount === 0) {
        effectiveRemainingTargetShares = 0; 
      } else {
        sharesCalcStatusMessage = '目標未設定';
      }
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex justify-between items-start mb-6">
        <h1 className="text-3xl font-bold text-gray-800">プロジェクト詳細: {project.Name} ({project.ProjectID || `Internal ID: ${project.internal_id}`})</h1>
        <div className="text-right"><p className="text-sm text-gray-600">TS担当者:</p><p className="text-lg font-semibold text-gray-700">{project.TS_Contact || 'N/A'}</p></div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white shadow-md rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">基本情報</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3 text-base">
            <p><strong className="font-semibold text-gray-600">銘柄コード:</strong> {project.Ticker}</p>
            <p><strong className="font-semibold text-gray-600">銘柄名:</strong> {project.Name}</p>
            <p><strong className="font-semibold text-gray-600">Side:</strong><span className={`ml-2 px-2 py-0.5 rounded-full text-sm font-semibold ${project.Side === 'BUY' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>{project.Side}</span></p>
            <p><strong className="font-semibold text-gray-600">総株数:</strong> {formatNumber(displayTotalShares, 0) ?? 'N/A'} 株</p>
            <p><strong className="font-semibold text-gray-600">総金額:</strong> {formatCurrency(displayTotalAmount) ?? 'N/A'}</p>
            <p><strong className="font-semibold text-gray-600">開始日:</strong> {project.Start_Date}</p>
            <p><strong className="font-semibold text-gray-600">終了日:</strong> {project.End_Date}</p>
            <p><strong className="font-semibold text-gray-600">価格制限:</strong> {formatNumber(project.Price_Limit, 0) ?? 'N/A'}</p>
            <p><strong className="font-semibold text-gray-600">成功報酬:</strong> {project.Performance_Based_Fee_Rate ?? 'N/A'}%</p>
            <p><strong className="font-semibold text-gray-600">固定手数料率:</strong> {project.Fixed_Fee_Rate ?? 'N/A'}%</p>
            <p><strong className="font-semibold text-gray-600">営業日数:</strong> {project.Business_Days ?? 'N/A'}</p>
            <p><strong className="font-semibold text-gray-600">営業日目:</strong> {tradedDays + 1}日目</p>
            <div className="md:col-span-2"><strong className="font-semibold text-gray-600 align-top">メモ:</strong> <span className="inline-block">{project.Note || 'N/A'}</span></div>
          </div>
        </div>
        <div className="bg-white shadow-md rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">プロジェクトサマリー (前営業日時点)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3 text-base">
              
              <p><strong className="font-semibold text-gray-600">約定進捗率:</strong> {formatNumber(project.executionProgress, 1)}%
                  <span className="text-xs text-gray-500 ml-2">
                      {
                          (project.Total_Shares !== null && project.Total_Shares > 0) ? 
                          `(${formatNumber(project.totalFilledQty,0)} / ${formatNumber(project.Total_Shares,0)} 株)` :
                          (project.Total_Amount !== null && project.Total_Amount > 0) ?
                          `(${formatCurrency(project.totalFilledAmount)} / ${formatCurrency(project.Total_Amount)})` :
                          'N/A'
                      }
                  </span>
              </p>

              <p><strong className="font-semibold text-gray-600">日数進捗率:</strong> {formatNumber(project.daysProgress, 1)}%
                  <span className="text-xs text-gray-500 ml-2">
                      (取引 {project.tradedDaysCount || 0}日 / 全 {project.Business_Days || 'N/A'}営業日)
                  </span>
              </p>

              <p><strong className="font-semibold text-gray-600">残存株数 (目安):</strong> 
                      {sharesCalcStatusMessage 
                          ? <span className="text-lg text-gray-600">{sharesCalcStatusMessage}</span>
                          : formatNumber(effectiveRemainingTargetShares, 0)
                      }
                      <span className="ml-1">株</span>
                  {remainingAmount !== null && (
                      <span className="text-xs text-gray-500 ml-2">
                          (残金額: {formatCurrency(remainingAmount)})
                      </span>
                  )}
              </p>
              
              <p><strong className="font-semibold text-gray-600">残存営業日数:</strong> 
                      {remainingBusinessDays !== null ? `${remainingBusinessDays}` : 'N/A'}
                      <span className="ml-1">日</span>
              </p>

              <p><strong className="font-semibold text-gray-600">ベンチマーク VWAP:</strong> {formatNumber(project.benchmarkVWAP)}</p>

              <p><strong className="font-semibold text-gray-600">平均約定単価:</strong> {formatNumber(project.averageExecutionPrice)}</p>

              <p><strong className="font-semibold text-gray-600">平均約定株数/日:</strong> 
                      {formatNumber(project.averageDailyShares, 0)}
                      <span className="ml-1">株</span>
              </p>
              {finalMetrics && (
                <>
                  <p><strong className="font-semibold text-gray-600">P/L (評価損益):</strong> 
                    <span className={`${finalMetrics.pl !== null && finalMetrics.pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(finalMetrics.pl, '-')}
                    </span>
                  </p>
                  <p><strong className="font-semibold text-gray-600">P/L (bps):</strong> 
                    <span className={`${finalMetrics.plBps !== null && finalMetrics.plBps >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatNumber(finalMetrics.plBps, 2, '-')}
                    </span>
                  </p>
                  <p><strong className="font-semibold text-gray-600">成功報酬額:</strong> 
                    <span className={`${finalMetrics.performanceFee !== null && finalMetrics.performanceFee > 0 ? 'text-green-600' : 'text-gray-800'}`}>
                      {formatCurrency(finalMetrics.performanceFee, formatCurrency(0))}
                    </span>
                  </p>
                  <p><strong className="font-semibold text-gray-600">固定手数料:</strong> 
                    <span>
                      {formatCurrency(finalMetrics.fixedFee, formatCurrency(0))}
                    </span>
                  </p>
                </>
              )}
          </div>
        </div>
      </div>
      
      <div className="bg-white shadow-md rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-700 mb-4 border-b pb-2">P/L シミュレーション</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 items-end">
            <div>
                <label htmlFor="simInputPrice" className="block text-sm font-medium text-gray-700">価格</label>
                <input type="number" name="simInputPrice" id="simInputPrice" value={simInputPrice} onChange={(e) => setSimInputPrice(e.target.value)}
                        onWheel={ e => (e.target as HTMLElement).blur() }
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="例: 101.0"/>
            </div>
            <div>
                <label htmlFor="simInputShares" className="block text-sm font-medium text-gray-700">株数</label>
                <input type="number" name="simInputShares" id="simInputShares" value={simInputShares} onChange={(e) => setSimInputShares(e.target.value)}
                        onWheel={ e => (e.target as HTMLElement).blur() }
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="例: 10000"/>
            </div>
            <div>
                <label htmlFor="simInputDays" className="block text-sm font-medium text-gray-700">シミュレーション日数</label>
                <input type="number" name="simInputDays" id="simInputDays" value={simInputDays} onChange={(e) => setSimInputDays(e.target.value)}
                        onWheel={ e => (e.target as HTMLElement).blur() }
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="例: 5" min="1"/>
            </div>
        </div>
        
        {fixedVolumeScenarios.length > 0 && (
            <div className="overflow-x-auto">
                <h3 className="text-md font-medium text-gray-700 mb-2">日数別シナリオ (入力した<span className="font-bold">株数</span>を毎日N日間取引)</h3>
                <table className="min-w-full leading-normal text-sm">
                    <thead>
                        <tr className="bg-gray-100 text-gray-600 uppercase text-xs leading-normal">
                            <th className="py-2 px-3 text-left">取引日数</th>
                            <th className="py-2 px-3 text-right">累計取引株数</th>
                            <th className="py-2 px-3 text-right">最終ベンチマーク</th>
                            <th className="py-2 px-3 text-right">入力価格vsベンチ(%)</th>
                            <th className="py-2 px-3 text-right">最終P/L</th>
                            <th className="py-2 px-3 text-right">最終P/L (bps)</th>
                        </tr>
                    </thead>
                    <tbody className="text-gray-700">
                        {fixedVolumeScenarios.map((scenario) => (
                            <tr key={scenario.day} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="py-2 px-3 text-left">{scenario.day} 日間</td>
                                <td className="py-2 px-3 text-right">{formatNumber(scenario.totalSharesTraded, 0)}</td>
                                <td className="py-2 px-3 text-right">{formatNumber(scenario.finalBenchmark, 4)}</td>
                                <td className={`py-2 px-3 text-right ${scenario.priceVsBenchmarkPct !== null && scenario.priceVsBenchmarkPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNumber(scenario.priceVsBenchmarkPct, 2)}%</td>
                                <td className={`py-2 px-3 text-right ${scenario.finalPL !== null && scenario.finalPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(scenario.finalPL)}</td>
                                <td className={`py-2 px-3 text-right ${scenario.finalPLBps !== null && scenario.finalPLBps >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNumber(scenario.finalPLBps, 2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}

        {futureScenarios.length > 0 && (
            <div className="overflow-x-auto mt-8">
                <h3 className="text-md font-medium text-gray-700 mb-2">終了日数別シナリオ (入力した<span className="font-bold">株数</span>をN日間で消化)</h3>
                <table className="min-w-full leading-normal text-sm">
                    <thead>
                        <tr className="bg-gray-100 text-gray-600 uppercase text-xs leading-normal">
                            <th className="py-2 px-3 text-left">シナリオ(日数)</th><th className="py-2 px-3 text-right">株数/日</th><th className="py-2 px-3 text-right">最終ベンチマーク</th>
                            <th className="py-2 px-3 text-right">入力価格vsベンチ(%)</th><th className="py-2 px-3 text-right">最終P/L</th><th className="py-2 px-3 text-right">最終P/L (bps)</th>
                        </tr>
                    </thead>
                    <tbody className="text-gray-700">
                        {futureScenarios.map((scenario) => (
                            <tr key={scenario.days} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="py-2 px-3 text-left">{scenario.description}</td><td className="py-2 px-3 text-right">{formatNumber(scenario.sharesPerDay, 0)}</td>
                                <td className="py-2 px-3 text-right">{formatNumber(scenario.finalBenchmark, 4)}</td>
                                <td className={`py-2 px-3 text-right ${scenario.priceVsBenchmarkPct !== null && scenario.priceVsBenchmarkPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNumber(scenario.priceVsBenchmarkPct, 2)}%</td>
                                <td className={`py-2 px-3 text-right ${scenario.finalPL !== null && scenario.finalPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(scenario.finalPL)}</td>
                                <td className={`py-2 px-3 text-right ${scenario.finalPLBps !== null && scenario.finalPLBps >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNumber(scenario.finalPLBps, 2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}

        {(futureScenarios.length === 0 && fixedVolumeScenarios.length === 0 && simInputPrice && simInputShares && simInputDays) && (
            <p className="text-gray-500 mt-4">入力値に基づいてシナリオを生成します...</p>
        )}
      </div>
      
      <div className="grid grid-cols-1 gap-6">
        {finalChartData ? (
            <div className="bg-white shadow-md rounded-lg p-4 md:p-6 flex flex-col">
                <div className="relative flex-grow min-h-[450px]">
                    <Chart type='line' data={finalChartData} options={chartOptions} />
                </div>
            </div>
          ) : <div />}
      </div>

      {displayStockRecords && displayStockRecords.length > 0 ? (
        <div className="bg-white shadow-md rounded-lg">
          <div className="flex justify-between items-center p-6 border-b">
            <h2 className="text-xl font-semibold text-gray-700">取引履歴</h2>
            <button
              onClick={() => setIsHistoryVisible(!isHistoryVisible)}
              className="text-sm text-indigo-600 hover:text-indigo-800 focus:outline-none"
            >
              {isHistoryVisible ? '隠す' : '表示する'} {isHistoryVisible ? '▲' : '▼'}
            </button>
          </div>
          {isHistoryVisible && (
            <div className="overflow-x-auto">
              <table className="min-w-full leading-normal">
                <thead>
                  <tr className="bg-gray-200 text-gray-600 uppercase text-xs leading-normal">
                    <th className="py-3 px-6 text-left">日付</th>
                    <th className="py-3 px-6 text-right">約定数量</th>
                    <th className="py-3 px-6 text-right">累積約定株数</th>
                    <th className="py-3 px-6 text-right">約定平均価格</th>
                    <th className="py-3 px-6 text-right">当日VWAP</th>
                    <th className="py-3 px-6 text-right">ベンチマーク推移</th>
                    <th className="py-3 px-6 text-right">VWAP Perf. (bps)</th>
                    <th className="py-3 px-6 text-right">P/L (評価損益)</th>
                    <th className="py-3 px-6 text-right">成功報酬額</th>
                    <th className="py-3 px-6 text-right">固定手数料(累積)</th>
                    <th className="py-3 px-6 text-right">P/L (bps)</th>
                    <th className="py-3 px-6 text-right">累積約定金額(円)</th>
                  </tr>
                </thead>
                <tbody className="text-gray-700 text-sm">
                  {displayStockRecords.map((record, index) => {
                    let performanceFeeAmount = 0;
                    const feeRate = project.Performance_Based_Fee_Rate;
                    if (record.dailyPL !== null && record.dailyPL > 0 && feeRate !== null && feeRate !== undefined) {
                      performanceFeeAmount = record.dailyPL * (feeRate / 100);
                    }

                    let plBpsDisplay: string | number = '-';
                    if (record.dailyPL !== null && record.cumulativeBenchmarkVWAP !== null && record.cumulativeBenchmarkVWAP > 0 && record.cumulativeFilledQty !== null && record.cumulativeFilledQty > 0) {
                        const denominator = record.cumulativeBenchmarkVWAP * record.cumulativeFilledQty;
                        if (denominator !== 0) {
                           plBpsDisplay = formatNumber((record.dailyPL / denominator) * 10000, 1, '-'); 
                        }
                    }
                    return (
                      <tr key={index} className={`border-b border-gray-200 hover:bg-gray-100 ${record.vwapPerformanceBps !== null && record.vwapPerformanceBps < 0 ? 'bg-red-50' : ''}`}>
                        <td className="py-3 px-6 text-left whitespace-nowrap">{record.Date}</td>
                        <td className="py-3 px-6 text-right">{formatNumber(record.FilledQty, 0)}</td>
                        <td className="py-3 px-6 text-right">{formatNumber(record.cumulativeFilledQty, 0, '-')}</td>
                        <td className="py-3 px-6 text-right">{formatNumber(record.FilledAveragePrice, 2)}</td>
                        <td className="py-3 px-6 text-right">{formatNumber(record.ALL_DAY_VWAP, 2)}</td>
                        <td className="py-3 px-6 text-right">{formatNumber(record.cumulativeBenchmarkVWAP, 2, '-')}</td>
                        <td className="py-3 px-6 text-right">{formatNumber(record.vwapPerformanceBps, 2, '-')}</td>
                        <td className={`py-3 px-6 text-right ${record.dailyPL !== null && record.dailyPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(record.dailyPL, '-')}</td>
                        <td className={`py-3 px-6 text-right ${performanceFeeAmount > 0 ? 'text-green-600' : ''}`}>{formatCurrency(performanceFeeAmount, performanceFeeAmount === 0 && record.dailyPL !== null && record.dailyPL <=0 ? formatCurrency(0) : '-')}</td>
                        <td className="py-3 px-6 text-right">{formatCurrency(record.cumulativeFixedFee, '-')}</td>
                        <td className="py-3 px-6 text-right">{plBpsDisplay}</td>
                        <td className="py-3 px-6 text-right">{formatCurrency(record.cumulativeFilledAmount, '-')}</td>
                      </tr>);
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : ( !loading && <p className="mt-6 text-gray-500">このプロジェクトの取引履歴はありません。</p>)}
    </div>
  );
};

export default ProjectDetailPage;