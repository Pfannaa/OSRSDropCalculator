import React, { useState, useRef } from 'react';
import { Chart } from 'chart.js/auto';
import './OSRSDropCalculator.css';

const OSRSDropCalculator = () => {
  const [isCalculating, setIsCalculating] = useState(false);
  const [progress, setProgress] = useState({ status: '', percent: 0 });
  
  // ... other state declarations ...
  const [dropRate, setDropRate] = useState(512);
  const [killCount, setKillCount] = useState(0);
  const [dropsReceived, setDropsReceived] = useState(0);
  const [results, setResults] = useState(null);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const binomialProbability = (n, k, p) => {
    if (k > n) return 0;
    if (k === 0) return Math.pow(1 - p, n);

    let logProb = 0;
    for (let i = 0; i < k; i++) {
      logProb += Math.log(n - i) - Math.log(i + 1);
    }
    logProb += k * Math.log(p) + (n - k) * Math.log(1 - p);

    return Math.exp(logProb);
  };

  const cumulativeBinomial = (n, k, p) => {
    let cumulative = 0;
    for (let i = 0; i <= k; i++) {
      cumulative += binomialProbability(n, i, p);
    }
    return cumulative;
  };

  const poissonProbability = (lambda, k) => {
    if (k === 0) return Math.exp(-lambda);

    let logProb = k * Math.log(lambda) - lambda;
    for (let i = 1; i <= k; i++) {
      logProb -= Math.log(i);
    }
    return Math.exp(logProb);
  };

  const createChart = (chartData, actualDrops, expectedDrops) => {
    if (!chartRef.current) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');

    const labels = chartData.map(d => d.drops.toString());
    const data = chartData.map(d => d.probability);
    const colors = chartData.map(d => {
      if (d.isYourResult) return '#ef4444';
      if (d.isExpected) return '#10b981';
      return '#8b5cf6';
    });

    chartInstance.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Probability (%)',
          data: data,
          backgroundColor: colors,
          borderColor: colors.map(color => color + '80'),
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Drop Distribution - Your Result vs Expected',
            color: 'white',
            font: {
              size: 16,
              weight: 'bold'
            }
          },
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: 'white',
            bodyColor: 'white',
            borderColor: 'rgba(255, 255, 255, 0.2)',
            borderWidth: 1,
            callbacks: {
              afterBody: function(context) {
                const index = context[0].dataIndex;
                const item = chartData[index];
                let extra = '';
                if (item.isYourResult) extra += '\n← Your Result';
                if (item.isExpected) extra += '\n← Expected';
                return extra;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Probability (%)',
              color: 'rgba(255, 255, 255, 0.7)'
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.7)'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            title: {
              display: true,
              text: 'Number of Drops',
              color: 'rgba(255, 255, 255, 0.7)'
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.7)'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    });
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const calculateProbabilities = async (killCount, dropRate, dropsReceived) => {
    await sleep(0); // Allow UI to update
    const p = 1 / dropRate;
    const expectedDrops = killCount * p;
    
    setProgress({ status: 'Calculating probabilities...', percent: 10 });
    
    let probabilityExact, probabilityAtMost;

    if (killCount > 1000 && p < 0.1) {
      probabilityExact = poissonProbability(expectedDrops, dropsReceived);
      let cumulativeAtMost = 0;
      
      // Process in chunks for large numbers
      const chunkSize = 1000;
      for (let i = 0; i <= dropsReceived; i += chunkSize) {
        const end = Math.min(i + chunkSize, dropsReceived);
        await sleep(0); // Allow UI updates between chunks
        
        for (let j = i; j <= end; j++) {
          cumulativeAtMost += poissonProbability(expectedDrops, j);
        }
        
        const progress = (i / dropsReceived) * 100;
        setProgress({ 
          status: 'Calculating probabilities...', 
          percent: 10 + (progress * 0.1) 
        });
      }
      probabilityAtMost = cumulativeAtMost;
    } else {
      probabilityExact = binomialProbability(killCount, dropsReceived, p);
      probabilityAtMost = cumulativeBinomial(killCount, dropsReceived, p);
    }

    return { probabilityExact, probabilityAtMost, expectedDrops };
  };

  const generateChartData = async (killCount, dropRate, dropsReceived, expectedDrops) => {
    const p = 1 / dropRate;
    const maxDrops = Math.min(killCount, Math.max(20, dropsReceived + 5, expectedDrops + 5));
    
    // Adjust number of data points based on range
    const targetDataPoints = killCount > 50000 ? 50 : 100;
    const step = Math.max(1, Math.ceil(maxDrops / targetDataPoints));
    
    const chartData = [];
    
    // Process in smaller chunks
    const chunkSize = 10;
    for (let i = 0; i <= maxDrops; i += step * chunkSize) {
      await sleep(0); // Allow UI to update between chunks
      
      const endIndex = Math.min(i + step * chunkSize, maxDrops);
      for (let j = i; j <= endIndex; j += step) {
        let prob;
        if (killCount > 1000 && p < 0.1) {
          prob = poissonProbability(expectedDrops, j) * 100;
        } else {
          prob = binomialProbability(killCount, j, p) * 100;
        }

        chartData.push({
          drops: j,
          probability: prob,
          isYourResult: j === dropsReceived,
          isExpected: j === Math.round(expectedDrops)
        });
      }
      
      const percentComplete = (i / maxDrops) * 100;
      setProgress({ 
        status: 'Generating chart data...', 
        percent: 30 + (percentComplete * 0.5) 
      });
    }

    // Ensure we include the exact drops received point
    if (!chartData.some(d => d.drops === dropsReceived)) {
      let prob;
      if (killCount > 1000 && p < 0.1) {
        prob = poissonProbability(expectedDrops, dropsReceived) * 100;
      } else {
        prob = binomialProbability(killCount, dropsReceived, p) * 100;
      }
      chartData.push({
        drops: dropsReceived,
        probability: prob,
        isYourResult: true,
        isExpected: dropsReceived === Math.round(expectedDrops)
      });
    }
    
    return chartData.sort((a, b) => a.drops - b.drops);
  };

  const formatProbability = (probability) => {
    if (probability === 0) {
      return '0%';
    } else if (probability < 0.001) {
      return '<0.001%';
    } else if (probability < 0.01) {
      return probability.toFixed(4) + '%';
    } else if (probability < 1) {
      return probability.toFixed(3) + '%';
    } else {
      return probability.toFixed(2) + '%';
    }
  };

  const calculate = async () => {
    if (!dropRate || killCount < 0 || dropsReceived < 0) {
      alert('Please enter valid numbers for all fields.');
      return;
    }

    setIsCalculating(true);
    setProgress({ status: 'Starting calculations...', percent: 0 });
    
    await sleep(50);

    try {
      const { probabilityExact, probabilityAtMost, expectedDrops } = 
        await calculateProbabilities(killCount, dropRate, dropsReceived);

      setProgress({ status: 'Preparing chart data...', percent: 30 });
      await sleep(0);

      const chartData = await generateChartData(
        killCount, 
        dropRate, 
        dropsReceived, 
        expectedDrops
      );

      setProgress({ status: 'Processing results...', percent: 80 });
      await sleep(0);

      let percentileLuckier;
      if (dropsReceived >= expectedDrops) {
        percentileLuckier = Math.max(0, Math.min(100, (1 - probabilityAtMost + probabilityExact) * 100));
      } else {
        percentileLuckier = Math.max(0, Math.min(100, probabilityAtMost * 100));
      }

      const dryStreakProb = dropsReceived >= expectedDrops ? 0 : (probabilityAtMost * 100);

      const newResults = {
        probabilityExact: formatProbability(probabilityExact * 100),
        percentileLuckier: Math.min(99.99, percentileLuckier).toFixed(2) + '%',
        expectedDrops,
        dryStreakProb: formatProbability(dryStreakProb),
        chartData,
        interpretation: generateInterpretation(
          dropsReceived, 
          expectedDrops, 
          percentileLuckier, 
          dryStreakProb
        )
      };

      setResults(newResults);
      setProgress({ status: 'Creating chart...', percent: 90 });
      await sleep(0);

      createChart(chartData, dropsReceived, expectedDrops);
      
      setProgress({ status: 'Complete!', percent: 100 });
      await sleep(100);
      
      setIsCalculating(false);
      setProgress({ status: '', percent: 0 });

    } catch (error) {
      console.error('Calculation error:', error);
      setIsCalculating(false);
      setProgress({ status: '', percent: 0 });
      alert('An error occurred during calculation. Please try again.');
    }
  };

  const generateInterpretation = (received, expected, percentile, dryStreak) => {
    let main = '';
    let lucky = '';
    let unlucky = '';

    if (received > expected) {
      main = `You've received ${received} drops when you'd expect about ${expected.toFixed(1)}. You're luckier than ${percentile.toFixed(1)}% of players with your kill count!`;
      lucky = `You're ${(received - expected).toFixed(1)} drops above the expected rate. Keep going while your luck is hot! 🔥`;
      unlucky = `Even though you're above rate, remember that RNG can be streaky. Don't get overconfident!`;
    } else if (received < expected) {
      const deficit = expected - received;
      main = `You've received ${received} drops when you'd expect about ${expected.toFixed(1)}. You're currently ${deficit.toFixed(1)} drops below the expected rate.`;
      lucky = `On the bright side, you're "due" for some good luck! The law of large numbers suggests things will balance out.`;
      unlucky = `You're currently in ${deficit.toFixed(1)} drop deficit. Only ${(100 - percentile).toFixed(1)}% of players are as unlucky as you at this KC.`;
    } else {
      main = `You're exactly at the expected drop rate! This is quite rare and shows perfect average luck.`;
      lucky = `Perfect balance - you're exactly where statistics predict you should be!`;
      unlucky = `You're right on track with the expected rate. No complaints here!`;
    }

    return { main, lucky, unlucky };
  };

  return (
    <div className="calculator-container">
      <div className="calculator-content">
        <div className="header">
          <h1>🎯 OSRS Drop Rate Calculator</h1>
          <p>Calculate your luck and see where you stand among other players</p>
        </div>

        <div className="input-card">
          <div className="input-grid">
            <div className="input-group">
              <label>Drop Rate (1 in X)</label>
              <input
                type="number"
                value={dropRate}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 0;
                  setDropRate(Math.min(Math.max(value, 1), 100000));
                }}
                placeholder="e.g., 512"
                min="1"
                max="100000"
              />
            </div>

            <div className="input-group">
              <label>Your Kill Count</label>
              <input
                type="number"
                value={killCount}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 0;
                  setKillCount(Math.min(Math.max(value, 0), 100000));
                }}
                placeholder="How many kills?"
                min="0"
                max="100000"
              />
            </div>

            <div className="input-group">
              <label>Drops Received</label>
              <input
                type="number"
                value={dropsReceived}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 0;
                  setDropsReceived(Math.min(Math.max(value, 0), 100000));
                }}
                placeholder="How many drops?"
                min="0"
                max="100000"
              />
            </div>
          </div>

          <div className="calculation-progress">
            <button 
              onClick={calculate} 
              className="calculate-button"
              disabled={isCalculating}
            >
              {isCalculating ? `⏳ ${progress.status} (${Math.round(progress.percent)}%)` : '🧮 Calculate Drop Statistics'}
            </button>

            {isCalculating && (
              <div className="progress-bar">
                <div 
                  className="progress-bar-fill" 
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {results && (
          <div className="results-card">
            <h2>📊 Your Drop Statistics</h2>

            <div className="stats-grid">
              <div className="stat-card probability">
                <div className="stat-value">{results.probabilityExact}</div>
                <div className="stat-label">Probability of Your Result</div>
              </div>

              <div className="stat-card percentile">
                <div className="stat-value">{results.percentileLuckier}</div>
                <div className="stat-label">Percentile</div>
              </div>

              <div className="stat-card expected">
                <div className="stat-value">{results.expectedDrops.toFixed(1)}</div>
                <div className="stat-label">Expected Drops</div>
              </div>

              <div className="stat-card dry-streak">
                <div className="stat-value">{results.dryStreakProb}</div>
                <div className="stat-label">Chance of Being This Dry</div>
              </div>
            </div>

            <div className="chart-container">
              <canvas ref={chartRef}></canvas>
            </div>

            <div className="interpretation">
              <h3>📈 What This Means</h3>
              <p className="main-interpretation">{results.interpretation.main}</p>

              <div className="interpretation-grid">
                <div className="lucky">
                  <h4>🍀 If You're Lucky</h4>
                  <p>{results.interpretation.lucky}</p>
                </div>
                <div className="unlucky">
                  <h4>😤 If You're Unlucky</h4>
                  <p>{results.interpretation.unlucky}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OSRSDropCalculator;