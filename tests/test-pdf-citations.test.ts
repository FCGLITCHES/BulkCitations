/**
 * PDF Citation Robustness Test
 * 
 * Feeds VERBATIM raw PDF-extracted text through the same segmentation logic
 * used by the client (reference-input.tsx), then through the engine pipeline.
 * 
 * Tests segmentation accuracy (should NOT over-split DOI lines, page headers,
 * URL lines, or wrapped continuation lines into separate references).
 */

import { processReferences } from '../server/engine/pipeline';
import { stripLeadingNumbering } from '../shared/stripNumbering';
import { describe, expect, it } from 'vitest';

// ── Client-side segmentation logic (extracted from reference-input.tsx) ──

function segmentRawText(text: string): string[] {
  const references: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);

  for (const paragraph of paragraphs) {
    if (paragraph.trim()) {
      const normalized = paragraph.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      const parts = normalized.split(/\s+(\[\d+\])\s+/).filter(Boolean);
      if (parts.length >= 3) {
        references.push(stripLeadingNumbering(parts[0].trim()));
        for (let i = 1; i < parts.length; i += 2) {
          const refText = (parts[i] + ' ' + (parts[i + 1] ?? '')).trim();
          if (refText) references.push(stripLeadingNumbering(refText));
        }
      } else {
        const cleanRef = stripLeadingNumbering(normalized);
        if (cleanRef) references.push(cleanRef);
      }
    }
  }

  if (references.length <= 1 && text.includes('\n')) {
    references.length = 0;
    const lines = text.split('\n');
    let currentRef = "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      const bracketNumMatch = trimmedLine.match(/^\s*\[\d+\]\s*(.+)/);
      const numberedMatch = bracketNumMatch ?? trimmedLine.match(/^\s*\[?\d+\]?\s*[.):\-–]\s*(.+)/);
      if (numberedMatch) {
        if (currentRef.trim()) references.push(currentRef.trim());
        currentRef = numberedMatch[1];
      } else {
        if (currentRef) {
          currentRef += " " + trimmedLine;
        } else {
          currentRef = trimmedLine;
        }
      }
    }
    if (currentRef.trim()) references.push(currentRef.trim());
  }

  if (references.length === 1 && references[0].length > 200) {
    const singleRef = references[0];
    references.length = 0;
    const parts = singleRef.split(/\.\s+(?=[A-Z][a-z]+,\s+[A-Z])/);
    for (let i = 0; i < parts.length; i++) {
      let part = parts[i].trim();
      if (i < parts.length - 1) part += '.';
      if (part.length > 20) references.push(part);
    }
  }

  return references;
}

// ── RAW PDF TEXT — verbatim as pasted by user ──

const RAW_PDF_VANCOUVER = `1. Jiménez-Luna J, Grisoni F, Weskamp N, Schneider G: Artificial intelligence in drug discovery: recent
advances and future perspectives. Expert Opin Drug Discov. 2021, 16:949-59.
10.1080/17460441.2021.1909567

2. Paul D, Sanap G, Shenoy S, Kalyane D, Kalia K, Tekade RK: Artificial intelligence in drug discovery and
development. Drug Discov Today. 2021, 26:80-93. 10.1016/j.drudis.2020.10.010

3. Sapoval N, Aghazadeh A, Nute MG, et al.: Current progress and open challenges for applying deep learning
across the biosciences. Nat Commun. 2022, 13: 10.1038/s41467-022-29268-7

4. Kim H, Kim E, Lee I, Bae B, Park M, Nam H: Artificial intelligence in drug discovery: a comprehensive review
of data-driven and machine learning approaches. Biotechnol Bioprocess Eng. 2020, 25:895-930.
10.1007/s12257-020-0049-y

5. You Y, Lai X, Pan Y, et al.: Artificial intelligence in cancer target identification and drug discovery . Signal
Transduct Target Ther. 2022, 7:10.1038/s41392-022-00994-0

6. Golriz Khatami S, Mubeen S, Bharadhwaj VS, Kodamullil AT, Hofmann-Apitius M, Domingo-Fernández D:
Using predictive machine learning models for drug response simulation by calibrating patient-specific
pathway signatures. NPJ Syst Biol Appl. 2021, 7:10.1038/s41540-021-00199-1

7. Adam G, Rampášek L, Safikhani Z, Smirnov P, Haibe-Kains B, Goldenberg A: Machine learning approaches
to drug response prediction: challenges and recent progress. NPJ Precis Oncol. 2020, 4:10.1038/s41698-020-
0122-1

8. Sorkun MC, Astruc S, Koelman JV, Er S: An artificial intelligence-aided virtual screening recipe for two-
dimensional materials discovery. Npj Comput Mater. 2020, 24:10.1038/s41524-020-00375-7

9. Gentile F, Yaacoub JC, Gleave J, et al.: Artificial intelligence-enabled virtual screening of ultra-large
chemical libraries with deep docking. Nat Protoc. 2022, 17:672-97. 10.1038/s41596-021-00659-2

10. Miljković F, Rodríguez-Pérez R, Bajorath J: Impact of artificial intelligence on compound discovery, design,
and synthesis. ACS Omega. 2021, 6:33293-9. 10.1021/acsomega.1c05512

11. Tapping into the drug discovery potential of AI . (2021). https://www.nature.com/articles/d43747-021-
00045-7.

12. Norrby PO: Holistic models of reaction selectivity. Nature. 2019, 571:332-3. 10.1038/d41586-019-02148-9

13. Cramer RD, Bunce JD, Patterson DE, Frank IE: Crossvalidation, bootstrapping, and partial least squares
2023 Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 15 of 17
compared with multiple regression in conventional QSAR studies. Mol Inform. 1988, 7:18-25.
10.1002/qsar.19880070105

14. Li Y, Zhang L, Wang Y, et al.: Generative deep learning enables the discovery of a potent and selective RIPK1
inhibitor. Nat Commun. 2022, 13: 10.1038/s41467-022-34692-w

15. Yang S, Hwang D, Lee S, Ryu S, Hwang SJ: Hit and lead discovery with explorative RL and fragment-based
molecule generation. Adv Neural Inf Process Syst. 2021, 6:7924-36.

16. Skalic M, Jiménez J, Sabbadin D, De Fabritiis G: Shape-based generative modeling for de novo drug design . J
Chem Inf Model. 2019, 59:1205-14. 10.1021/acs.jcim.8b00706

17. Sousa T, Correia J, Pereira V, Rocha M: Generative deep learning for targeted compound design . J Chem Inf
Model. 2021, 61:5343-61. 10.1021/acs.jcim.0c01496

18. Tran TT, Tayara H, Chong KT: Artificial intelligence in drug metabolism and excretion prediction: recent
advances, challenges, and future perspectives. Pharmaceutics. 2023, 15:10.3390/pharmaceutics15041260

19. Dara S, Dhamercherla S, Jadav SS, Babu CM, Ahsan MJ: Machine learning in drug discovery: a review . Artif
Intell Rev. 2022, 55:1947-99. 10.1007/s10462-021-10058-4

20. Sahu A, Mishra J, Kushwaha N: Artificial intelligence (AI) in drugs and pharmaceuticals . Comb Chem High
Throughput Screen. 2022, 25:1818-37. 10.2174/1386207325666211207153943

21. Djoumbou-Feunang Y, Fiamoncini J, Gil-de-la-Fuente A, Greiner R, Manach C, Wishart DS: BioTransformer:
a comprehensive computational tool for small molecule metabolism prediction and metabolite
identification. J Cheminform. 2019, 11: 10.1186/s13321-018-0324-5

22. Kumar A, Kini SG, Rathi E: A recent appraisal of artificial intelligence and in silico ADMET prediction in the
early stages of drug discovery. Mini Rev Med Chem. 2021, 21:2788-800.
10.2174/1389557521666210401091147

23. Wu F, Zhou Y, Li L, et al.: Computational approaches in preclinical studies on drug discovery and
development. Front Chem. 2020, 8: 10.3389/fchem.2020.00726

24. Daina A, Michielin O, Zoete V: SwissADME: a free web tool to evaluate pharmacokinetics, drug-likeness and
medicinal chemistry friendliness of small molecules. Sci Rep. 2017, 7: 10.1038/srep42717

25. Zhang D, Luo G, Ding X, Lu C: Preclinical experimental models of drug metabolism and disposition in drug
discovery and development. Acta Pharm Sin B. 2012, 2:549-61. 10.1016/j.apsb.2012.10.004

26. Shi H, Tian S, Li Y, Li D, Yu H, Zhen X, Hou T: Absorption, distribution, metabolism, excretion, and toxicity
evaluation in drug discovery. 14. Prediction of human pregnane X receptor activators by using naive
Bayesian classification technique. Chem Res Toxicol. 2015, 28:116-25. 10.1021/tx500389q

27. Ekins S, Nikolsky Y, Nikolskaya T: Techniques: application of systems biology to absorption, distribution,
metabolism, excretion and toxicity. Trends Pharmacol Sci. 2005, 26:202-9. 10.1016/j.tips.2005.02.006

28. Maltarollo VG, Gertrudes JC, Oliveira PR, Honorio KM: Applying machine learning techniques for ADME-
Tox prediction: a review. Expert Opin Drug Metab Toxicol. 2015, 11:259-71. 10.1517/17425255.2015.980814

29. Falcón-Cano G, Molina C, Cabrera-Pérez MÁ: Reliable prediction of Caco-2 permeability by supervised
recursive machine learning approaches. Pharmaceutics. 2022, 14:10.3390/pharmaceutics14101998

30. Wu Z, Lei T, Shen C, Wang Z, Cao D, Hou T: ADMET evaluation in drug discovery. 19. Reliable prediction of
human cytochrome P450 inhibition using artificial intelligence approaches. J Chem Inf Model. 2019,
59:4587-601. 10.1021/acs.jcim.9b00801

31. Zhang Y, Lei X, Pan Y, Wu FX: Drug repositioning with GraphSAGE and clustering constraints based on drug
and disease networks. Front Pharmacol. 2022, 13: 10.3389/fphar.2022.872785

32. Wang J, Wang W, Yan C, Luo J, Zhang G: Predicting drug-disease association based on ensemble strategy .
Front Genet. 2021, 12:10.3389/fgene.2021.666575

33. Kang H, Hou L, Gu Y, Lu X, Li J, Li Q: Drug-disease association prediction with literature based multi-
feature fusion. Front Pharmacol. 2023, 14: 10.3389/fphar.2023.1205144

34. Zhang W, Yue X, Huang F, Liu R, Chen Y, Ruan C: Predicting drug-disease associations and their
therapeutic function based on the drug-disease association bipartite network. Methods. 2018, 145:51-9.
10.1016/j.ymeth.2018.06.001

35. Wu C, Gudivada RC, Aronow BJ, Jegga AG: Computational drug repositioning through heterogeneous
network clustering. BMC Syst Biol. 2013, 7:10.1186/1752-0509-7-S5-S6

36. Gottlieb A, Stein GY, Ruppin E, Sharan R: PREDICT: a method for inferring novel drug indications with
application to personalized medicine. Mol Syst Biol. 2011, 7:10.1038/msb.2011.26

37. Napolitano F, Zhao Y, Moreira VM, Tagliaferri R, Kere J, D'Amato M, Greco D: Drug repositioning: a
machine-learning approach through data integration. J Cheminform. 2013, 5: 10.1186/1758-2946-5-30

38. Cruz Rivera S, Liu X, Chan AW, Denniston AK, Calvert MJ: Guidelines for clinical trial protocols for
interventions involving artificial intelligence: the SPIRIT-AI extension. Nat Med. 2020, 26:1351-63.
10.1038/s41591-020-1037-7

39. Liu X, Rivera SC, Moher D, Calvert MJ, Denniston AK: Reporting guidelines for clinical trial reports for
interventions involving artificial intelligence: the CONSORT-AI extension. Nat Med. 2020, 26:1364-74.
10.1038/s41591-020-1034-x

40. Harrer S, Shah P, Antony B, Hu J: Artificial intelligence for clinical trial design . Trends Pharmacol Sci. 2019,
40:577-91. 10.1016/j.tips.2019.05.005

41. Intelligent clinical trials . (2020).
https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-
trials/DI_Intelligent-clinical-....

42. Pesapane F, Codari M, Sardanelli F: Artificial intelligence in medical imaging: threat or opportunity?
Radiologists again at the forefront of innovation in medicine. Eur Radiol Exp. 2018, 2:10.1186/s41747-018-
0061-6

43. Salas M, Petracek J, Yalamanchili P, et al.: The use of artificial intelligence in pharmacovigilance: a
systematic review of the literature. Pharmaceut Med. 2022, 36:295-306. 10.1007/s40290-022-00441-z

44. Syrowatka A, Song W, Amato MG, et al.: Key use cases for artificial intelligence to reduce the frequency of
adverse drug events: a scoping review. Lancet Digit Health. 2022, 4:137-48. 10.1016/S2589-7500(21)00229-6

45. Bate A, Hobbiger SF: Artificial intelligence, real-world automation and the safety of medicines . Drug Saf.
2023 
Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 16 of 17
2021, 44:125-32. 10.1007/s40264-020-01001-7

46. Lavertu A, Vora B, Giacomini KM, Altman R, Rensi S: A new era in pharmacovigilance: toward real-world
data and digital monitoring. Clin Pharmacol Ther. 2021, 109:1197-202. 10.1002/cpt.2172

47. Danysz K, Cicirello S, Mingle E, et al.: Artificial intelligence and the future of the drug safety professional .
Drug Saf. 2019, 42:491-7. 10.1007/s40264-018-0746-z

48. Botsis T, Kreimeyer K: Improving drug safety with adverse event detection using natural language
processing. Expert Opin Drug Saf. 2023, 1-10. 10.1080/14740338.2023.2228197

49. Fan B, Fan W, Smith C, Garner HS: Adverse drug event detection and extraction from open data: a deep
learning approach. Inf Process Manag. 2020, 57:102131-10. 10.1016/j.ipm.2019.102131

50. Johnson KB, Wei WQ, Weeraratne D, et al.: Precision medicine, AI, and the future of personalized health
care. Clin Transl Sci. 2021, 14:86-93. 10.1111/cts.12884

51. Schork NJ: Artificial intelligence and personalized medicine. Cancer Treat Res. 2019, 178:265-83.
10.1007/978-3-030-16391-4_11

52. Terman SW: Rise of the machines? Predicting brivaracetam response using machine learning . Epilepsy Curr.
2022, 22:111-3. 10.1177/15357597211049052

53. Mukhopadhyay A, Sumner J, Ling LH, et al.: Personalised dosing using the CURATE.AI algorithm: protocol
for a feasibility study in patients with hypertension and type II diabetes mellitus. Int J Environ Res Public
Health. 2022, 19:10.3390/ijerph19158979

54. Rodríguez-Pérez R, Bajorath J: Evolution of support vector machine and regression modeling in
chemoinformatics and drug discovery. J Comput Aided Mol Des. 2022, 36:355-62. 10.1007/s10822-022-
00442-9

55. Krishna S, Lakra AD, Shukla N, Khan S, Mishra DP, Ahmed S, Siddiqi MI: Identification of potential histone
deacetylase1 (HDAC1) inhibitors using multistep virtual screening approach including SVM model,
pharmacophore modeling, molecular docking and biological evaluation. J Biomol Struct Dyn. 2020, 38:3280-95. 10.1080/07391102.2019.1654925

56. Uddin S, Khan A, Hossain ME, Moni MA: Comparing different supervised machine learning algorithms for
disease prediction. BMC Med Inform Decis Mak. 2019, 19: 10.1186/s12911-019-1004-8

57. Barardo DG, Newby D, Thornton D, Ghafourian T, de Magalhães JP, Freitas AA: Machine learning for
predicting lifespan-extending chemical compounds. Aging (Albany NY). 2017, 9:1721-37.
10.18632/aging.101264

58. Vamathevan J, Clark D, Czodrowski P, et al.: Applications of machine learning in drug discovery and
development. Nat Rev Drug Discov. 2019, 18:463-77. 10.1038/s41573-019-0024-5

59. Peng J, Jury EC, Dönnes P, Ciurtin C: Machine learning techniques for personalised medicine approaches in
immune-mediated chronic inflammatory diseases: applications and challenges. Front Pharmacol. 2021,
12:10.3389/fphar.2021.720694

60. Abbasi Mesrabadi H, Faez K, Pirgazi J: Drug-target interaction prediction based on protein features, using
wrapper feature selection. Sci Rep. 2023, 13: 10.1038/s41598-023-30026-y

61. Sachdev K, Gupta MK: A comprehensive review of feature based methods for drug target interaction
prediction. J Biomed Inform. 2019, 93: 10.1016/j.jbi.2019.103159

62. Wolfgang M, Weißensteiner M, Clarke P, Hsiao WK, Khinast JG: Deep convolutional neural networks:
Outperforming established algorithms in the evaluation of industrial optical coherence tomography (OCT)
images of pharmaceutical coatings. Int J Pharm X. 2020, 2:10.1016/j.ijpx.2020.100058

63. Gupta R, Srivastava D, Sahu M, Tiwari S, Ambasta RK, Kumar P: Artificial intelligence to deep learning:
machine intelligence approach for drug discovery. Mol Divers. 2021, 25:1315-60. 10.1007/s11030-021-
10217-3

64. Koras K, Juraeva D, Kreis J, Mazur J, Staub E, Szczurek E: Feature selection strategies for drug sensitivity
prediction. Sci Rep. 2020, 10: 10.1038/s41598-020-65927-9

65. Pudjihartono N, Fadason T, Kempa-Liehr AW, O'Sullivan JM: A review of feature selection methods for
machine learning-based disease risk prediction. Front Bioinform. 2022, 2: 10.3389/fbinf.2022.927312

66. Ali M, Aittokallio T: Machine learning and feature selection for drug response prediction in precision
oncology applications. Biophys Rev. 2019, 11:31-9. 10.1007/s12551-018-0446-z

67. Lai PK, Fernando A, Cloutier TK, et al.: Machine learning feature selection for predicting high concentration
therapeutic antibody aggregation. J Pharm Sci. 2021, 110:1583-91. 10.1016/j.xphs.2020.12.014

68. Chen R, Liu X, Jin S, Lin J, Liu J: Machine learning for drug-target interaction prediction. Molecules. 2018,
23:10.3390/molecules23092208

69. Alaimo S, Giugno R, Pulvirenti A: Recommendation techniques for drug-target interaction prediction and
drug repositioning. Methods Mol Biol. 2016, 1415:441-62. 10.1007/978-1-4939-3572-7_23

70. Yu W, Jiang Z, Wang J, Tao R: Using feature selection technique for drug-target interaction networks
prediction. Curr Med Chem. 2011, 18:5687-93. 10.2174/092986711798347270

71. Murdoch B: Privacy and artificial intelligence: challenges for protecting health information in a new era .
BMC Med Ethics. 2021, 22:10.1186/s12910-021-00687-3

72. Bak M, Madai VI, Fritzsche MC, Mayrhofer MT, McLennan S: You can't have AI both ways: balancing health
data privacy and access fairly. Front Genet. 2022, 13: 10.3389/fgene.2022.929453

73. van der Lee M, Swen JJ: Artificial intelligence in pharmacology research and practice. Clin Transl Sci. 2023,
16:31-6. 10.1111/cts.13431

74. Raimundo R, Rosário A: The impact of artificial intelligence on data system security: a literature review .
Sensors (Basel). 2021, 21:10.3390/s21217029

75. Forcier MB, Gallois H, Mullan S, Joly Y: Integrating artificial intelligence into health care through data
access: can the GDPR act as a beacon for policymakers?. J Law Biosci. 2019, 16:317-35. 10.1093/jlb/lsz013

76. Raza MA, Aziz S, Noreen M, Saeed A, Anjum I, Ahmed M, Raza SM: Artificial intelligence (AI) in pharmacy:
an overview of innovations. Innov Pharm. 2020, 13: 10.24926/iip.v13i2.4839

77. Kolluri S, Lin J, Liu R, Zhang Y, Zhang W: Machine learning and artificial intelligence in pharmaceutical
research and development: a review. AAPS J. 2022, 24: 10.1208/s12248-021-00644-3
2023 
78. Singh et al. Cureus 15(8): e44359. DOI 10.7759/cureus.44359 17 of 17`;

const RAW_PDF_VANCOUVER_DUPE = `References
1. Jiménez-Luna J, Grisoni F, Weskamp N, Schneider G: Artificial intelligence in drug discovery: recent
advances and future perspectives. Expert Opin Drug Discov. 2021, 16:949-59.
10.1080/17460441.2021.1909567

2. Paul D, Sanap G, Shenoy S, Kalyane D, Kalia K, Tekade RK: Artificial intelligence in drug discovery and
development. Drug Discov Today. 2021, 26:80-93. 10.1016/j.drudis.2020.10.010

3. Sapoval N, Aghazadeh A, Nute MG, et al.: Current progress and open challenges for applying deep learning
across the biosciences. Nat Commun. 2022, 13: 10.1038/s41467-022-29268-7`;

const RAW_PDF_BRACKET = `[1] Whitley D, A genetic algorithm tutorial, Statistics and computing, 1994 Jun 1;4(2):65-85. 

[2] Goldberg DE, Holland JH, Genetic algorithms and machine learning, 1988. 

[3] Holland JH, Genetic algorithms, Scientific American, 1992 Jul 1;267(1), 66-73.
 
[4] Mirjalili S, Dong JS, Sadiq AS, Faris H. Genetic algorithm: Theory, literature review, and 
application in image reconstruction. InNature-Inspired Optimizers 2020 (pp. 69-85). 


[5] Mirjalili, Seyedali, Genetic algorithm, In Evolutionary algorithms and neural networks, pp. 43-55. Springer, Cham, 2019.

[6] Kramer, Olive, Genetic algorithm essentials, Vol. 679. Springer, 2017.

[7] S. R, R. T, A review of selection methods in genetic algorithm, Int. j. of eng. Sc. and tech., 
2011 May, 3(5), 3792-7. 

[8] Arabali, Amirsaman, Mahmoud Ghofrani, Mehdi Etezadi-Amoli, M. Sami Fadali, and Ya-
hia Baghzouz. "Genetic-algorithm-based optimization approach for energy management." 
IEEE Transactions on Power Delivery 28, no. 1 (2012): 162-170.

[9] Mathew, T.V., 2012. Genetic algorithm. Report submitted at IIT Bombay.

[10] Tabassum M, Mathew K, A genetic algorithm analysis towards optimization solutions, In-
ternational Journal of Digital Information and Wireless Communications (IJDIWC), 2014 
Jan 1, 4(1), 124-42.

[11] Yang, Jinhui, Chunguo Wu, Heow Pueh Lee, and Yanchun Liang. "Solving traveling 
salesman problems using generalized chromosome genetic algorithm." Progress in Natural 
Science 18, no. 7 (2008): 887-892.

[12] Hariyadi, Putri Mutira, Phong Thanh Nguyen, Iswanto Iswanto, and Dadang Sudrajat. 
"Traveling Salesman Problem Solution using Genetic Algorithm." Journal of Critical Re-
views, Vol 7, no. 1 (2020): 56-61.

[13] Tanweer Alam, "IoT-Fog: A Communication Framework using Blockchain in the Internet 
of Things", International Journal of Recent Technology and Engineering (IJRTE), Vol-
ume-7, Issue-6, 2019. 

[14] Tanweer Alam, "Blockchain and its Role in the Internet of Things (IoT)", International 
Journal of Scientific Research in Computer Science, Engineering and Information Tech-
nology, vol. 5(1), pp. 151-157, 2019. DOI: https://doi.org/10.32628/CSEIT195137

[15] Tanweer Alam, "Internet of Things: A Secure Cloud-Based MANET Mobility Model", In-
ternational Journal of Network Security, Vol. 22(3), 2020.

[16] Tanweer Alam, "Efficient and Secure Data Transmission Approach in Cloud-MANET-IoT 
integrated Framework", Journal of Telecommunication, Electronic and Computer Engi Paper\u2014 Genetic Algorithm: Reviews, Implementation and Applications

[17] Alam T, Benaida M. "The Role of Cloud-MANET Framework in the Internet of Things 
(IoT)", International Journal of Online Engineering (iJOE). Vol. 14(12), pp. 97-111. DOI: 
https://doi.org/10.3991/ijoe.v14i12.8338 

[18] Alam, Tanweer. "Middleware Implementation in Cloud-MANET Mobility Model for In-
ternet of Smart Devices", International Journal of Computer Science and Network Secu-
rity, 17(5), 2017. Pp. 86-94
[19] Alam T, Benaida M. CICS: Cloud\u2013Internet Communication Security Framework for the 
Internet of Smart Devices. International Journal of Interactive Mobile Technologies 
(iJIM). 2018 Nov 1;12(6):74-84. DOI: https://doi.org/10.3991/ijim.v12i6.6776

[20] Alam, Tanweer. (2018) "A reliable framework for communication in internet of smart de-
vices using IEEE 802.15.4." ARPN Journal of Engineering and Applied Sciences 13(10), 
3378-3387. 

[21] Alam, Tanweer, and Mohammed Aljohani. "Design and implementation of an Ad Hoc 
Network among Android smart devices." In Green Computing and Internet of Things 
(ICGCIoT), 2015 International Conference on, pp. 1322-1327. IEEE, 2015. DOI: 
https://doi.org/10.1109/ICGCIoT.2015.7380671 

[22] Alam, Tanweer, and Mohammed Aljohani. "An approach to secure communication in mo-
bile ad-hoc networks of Android devices." In 2015 International Conference on Intelligent
Informatics and Biomedical Sciences (ICIIBMS), pp. 371-375. IEEE, 2015. DOI: 
https://doi.org/10.1109/iciibms.2015.7439466 

[23] Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database 
using wireless technologies." In Computational Intelligence and Computing Research 
(ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: 
https://doi.org/10.1109/iccic.2015.7435818 

[24] Alam, Tanweer, and Mohammed Aljohani. "Design a new middleware for communication 
in ad hoc network of android smart devices." In Proceedings of the Second International 
Conference on Information and Communication Technology for Competitive Strategies, p. 
38. ACM, 2016. DOI: https://doi.org/10.1145/2905055.2905244 

[25] Alam, Tanweer. "Fuzzy control based mobility framework for evaluating mobility models 
in MANET of smart devices." ARPN Journal of Engineering and Applied Sciences 12, no. 
15 (2017): 4526-4538.

[26] Tanweer Alam, Mohamed Benaida. "Blockchain and Internet of Things in Higher Educa-
tion." Universal Journal of Educational Research 8.5 (2020). pp 2164 - 2174. DOI: 
https://doi.org/ 10.13189/ujer.2020.080556

[27] Tanweer Alam, Mohamed Benaida, "Blockchain, Fog and IoT Integrated Framework: Re-
view, Architecture and Evaluation", Technology Reports of Kansai University, Volume -
62 , Issue 02, 2020.

[28] Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Arti-
ficial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.

[29] Jedlicka, P., Ryba, T. Genetic algorithm application in image segmentation. Pattern Recog-
nit. Image Anal. 26, 497\u2013501 (2016). 

[30] Baker, Barrie M., and M. A. Ayechew. "A genetic algorithm for the vehicle routing prob-
lem." Computers & Operations Research 30, no. 5 (2003): 787-800.

[31] Sivanandam, S. N., and S. N. Deepa. "Genetic algorithm optimization problems." In Intro-
duction to genetic algorithms, pp. 165-209. Springer, Berlin, Heidelberg, 2008.

[32] Cuevas, Erik, Daniel Zald\u00edvar, and Marco P\u00e9rez-Cisneros. "A swarm optimization algo-
rithm for multimodal functions and its application in multicircle detection." Mathematical 
Problems in Engineering 2013 (2013). Paper\u2014 Genetic Algorithm: Reviews, Implementation and Applications

[33] Brooks, Arthur C. "Genetic algorithms and public economics." Journal of Public Economic 
Theory 2, no. 4 (2000): 493-513.

[34] Whitley, D., Starkweather, T. and Bogart, C., 1990. Genetic algorithms and neural net-
works: Optimizing connections and connectivity. Parallel computing, 14(3), pp.347-361.

[35] Nugroho, E.D., Wibowo, M.E. and Pulungan, R., 2017, July. Parallel implementation of 
genetic algorithm for searching optimal parameters of artificial neural networks. In 2017 
3rd International Conference on Science and Technology-Computer (ICST) (pp. 136-141). 
IEEE.

[36] Shrivastava, P., Dhingra, S.L. and Gundaliya, P.J., 2002. Application of genetic algorithm 
for scheduling and schedule coordination problems. Journal of advanced transporta-
tion, 36(1), pp.23-41.

[37] Toogood, R., Hao, H. and Wong, C., 1995, October. Robot path planning using genetic al-
gorithms. In 1995 IEEE International Conference on Systems, Man and Cybernetics. Intel-
ligent Systems for the 21st Century (Vol. 1, pp. 489-494). IEEE.

[38] Marta, A.C., 2008. Parametric study of a genetic algorithm using a aircraft design optimi-
zation problem. Report Stanford University, Department of Aeronautics and Astronautics.

[39] Piserchia, Zachary. "Applications of Genetic Algorithms in Bioinformatics." PhD diss., 
UC Riverside, 2018.

[40] Cvjetkovic, Vladimir. "Pocket labs supported IoT teaching." International Journal of Engi-
neering Pedagogy 8, no. 2 (2018): 32-48.

[41] Mironova, Olga, Irina Amitan, and J\u00fcri Vilip\u00f5ld. "Programming basics for beginners: Ex-
perience of the institute of informatics at Tallinn University of Technology." International 
Journal of Engineering Pedagogy. Vol. 7, No. 4, 2017

[42] Atoum, Issa. "A Spiral Software Engineering Model to Inspire Innovation and Creativity 
of University Students." International Journal of Engineering Pedagogy (iJEP) 9, no. 5 
(2019): 7-23.

[43] Liao, Y.H. and Sun, C.T., 2001. An educational genetic algorithms learning tool. IEEE 
transactions on Education, 44(2), pp.20-pp.

[44] Tanweer Alam. mHealth Communication Framework using blockchain and IoT Technolo-
gies. International Journal of Scientific & Technology Research. Vol 9(6), 2020

[45] T. Alam "Design a blockchain-based middleware layer in the Internet of Things Architec-
ture," JOIV : International Journal on Informatics Visualization, vol. 4, no. 1, , pp. 28 - 31, 
Feb. 2020. https://doi.org/10.30630/joiv.4.1.334

[46] Rajsingh, Elijah Blessing, Jey Veerasamy, Amir H. Alavi, and J. Dinesh Peter, eds. Ad-
vances in Big Data and Cloud Computing. Vol. 645. Springer, 2018.`;

// ── Full combined raw text as user would paste it ──
const FULL_RAW_INPUT = RAW_PDF_VANCOUVER + '\n\n' + RAW_PDF_VANCOUVER_DUPE + '\n\n' + RAW_PDF_BRACKET;

// ── Diagnostic runner ──

const REQUIRED_FIELDS = ['authors', 'title', 'year'] as const;

type Verdict = 'PASS' | 'REVIEW' | 'FAIL';

function getVerdict(ref: any): Verdict {
  const pd = ref.parsedData ?? {};
  const conf = ref.confidence?.score ?? 0;
  const missing = REQUIRED_FIELDS.filter(f => {
    const v = (pd as any)[f];
    return !v || (Array.isArray(v) && v.length === 0);
  });
  if (missing.length > 0 || conf < 45) return 'FAIL';
  if (conf < 65) return 'REVIEW';
  return 'PASS';
}

async function runDiagnostic(refs: string[], label: string) {
  const result = await processReferences(refs, {
    inputStyle: 'auto', outputStyle: 'apa',
    enrichWithAuthority: false, isPro: false,
  });

  let pass = 0, review = 0, fail = 0;
  const failedRefs: string[] = [];

  for (let i = 0; i < result.references.length; i++) {
    const v = getVerdict(result.references[i]);
    if (v === 'PASS') pass++;
    else if (v === 'REVIEW') review++;
    else {
      fail++;
      failedRefs.push(`  [${i+1}] ${refs[i]?.slice(0, 80)}...`);
    }
  }

  console.log(`\n── ${label} ──`);
  console.log(`  Segments: ${refs.length}`);
  console.log(`  Pipeline output: ${result.references.length}`);
  console.log(`  PASS: ${pass}  REVIEW: ${review}  FAIL: ${fail}`);
  if (failedRefs.length > 0 && failedRefs.length <= 20) {
    console.log('  Failed refs:');
    failedRefs.forEach(f => console.log(f));
  }

  return { segmented: refs.length, output: result.references.length, pass, review, fail };
}

// ── Main diagnostic runner ──

async function runPdfDiagnostic() {
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║  PDF Citation Robustness Diagnostic           ║');
  console.log('╚═══════════════════════════════════════════════╝');

  // Test 1: Segmentation count for Vancouver block only (should be ~78, not 100+)
  const vanSegments = segmentRawText(RAW_PDF_VANCOUVER);
  console.log(`\n[SEGMENTATION] Vancouver block: ${vanSegments.length} segments (expect ~78)`);

  // Test 2: Segmentation count for bracket block only (should be 46)
  const bracketSegments = segmentRawText(RAW_PDF_BRACKET);
  console.log(`[SEGMENTATION] Bracket block: ${bracketSegments.length} segments (expect 46)`);

  // Test 3: Full combined input (should be ~127 unique, not 203+)
  const fullSegments = segmentRawText(FULL_RAW_INPUT);
  console.log(`[SEGMENTATION] Full combined: ${fullSegments.length} segments (expect ≤130, got ${fullSegments.length})`);
  if (fullSegments.length > 150) {
    console.log(`  ⚠ OVER-SPLITTING DETECTED: ${fullSegments.length} segments is too many!`);
    // Show what junk segments were created
    const junkPatterns = fullSegments.filter(s =>
      /^\d+\.\d+\//.test(s) ||                    // bare DOI
      /^https?:\/\//.test(s) ||                     // bare URL
      /Singh et al\. Cureus/i.test(s) ||            // page header
      /^\d+ of \d+$/.test(s) ||                     // page number
      /^References$/i.test(s) ||                    // heading
      /^Paper—/.test(s) ||                          // section marker
      s.length < 25                                 // too short
    );
    if (junkPatterns.length > 0) {
      console.log(`  Junk segments (${junkPatterns.length}):`);
      junkPatterns.slice(0, 10).forEach(j => console.log(`    "${j.slice(0, 60)}"`));
    }
  }

  // Test 4: Pipeline accuracy on cleaned Vancouver refs
  const r1 = await runDiagnostic(vanSegments, '77 Vancouver (drug discovery paper)');

  // Test 5: Pipeline accuracy on bracket refs
  const r2 = await runDiagnostic(bracketSegments, '46 Bracket (genetic algorithm paper)');

  // Summary
  const total = r1.output + r2.output;
  const totalPass = r1.pass + r2.pass;
  const totalFail = r1.fail + r2.fail;
  const totalReview = r1.review + r2.review;

  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log(`║  TOTALS: ${total} refs processed                    ║`);
  console.log(`║  PASS:   ${totalPass}  REVIEW: ${totalReview}  FAIL: ${totalFail}`.padEnd(48) + '║');
  console.log(`║  Pass rate: ${((totalPass/total)*100).toFixed(1)}%`.padEnd(48) + '║');
  console.log('╚═══════════════════════════════════════════════╝');

  return {
    bracketSegments,
    fullSegments,
    total,
    totalFail,
    totalPass,
    totalReview,
    vanSegments,
  };
}

describe('PDF Citation Robustness Diagnostic', () => {
  it('runs without catastrophic segmentation drift', async () => {
    const result = await runPdfDiagnostic();

    expect(result.vanSegments.length).toBeLessThanOrEqual(85);
    expect(result.bracketSegments.length).toBe(46);
    expect(result.fullSegments.length).toBeLessThanOrEqual(130);
    expect(result.total).toBeGreaterThanOrEqual(120);
  });
});
