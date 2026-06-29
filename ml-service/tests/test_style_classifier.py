from __future__ import annotations

import unittest

from app.style_classifier import (
    StyleDecisionPolicyBundle,
    load_style_bundle,
    load_style_decision_policy,
    predict_style,
    predict_style_batch,
)


class StyleClassifierTest(unittest.TestCase):
    def test_loads_builtin_bundle_without_external_artifact(self) -> None:
        bundle = load_style_bundle()
        self.assertTrue(bundle.model_version)
        self.assertEqual(bundle.feature_version, "style-features-v1")

    def test_predicts_current_six_style_examples(self) -> None:
        predictions = predict_style_batch(
            [
                "Alexandra A. Taylor. (2022). Obituary: John H. Litchfield. Chemical & Engineering News, 25–25. https://doi.org/10.47287/cen-10040-obits4",
                "BSI British Standards (2013) Lamps for road vehicles. Dimensional, electrical and luminous requirements. BSI British Standards. Available at: https://doi.org/10.3403/01032627.",
                "Trаtsiak, A. I. “THE 100-YEAR HISTORY OF THE NATIONAL LIBRARY OF BELARUS IN THE AUDIO-VISUAL DOCUMENTS OF THE BELARUSIAN STATE ARCHIVES OF FILMS, PHOTOGRAPHS AND SOUND.” 2022, LIBRARIES IN THE INFORMATION SOCIETY: PRESERVING TRADITIONS AND DEVELOPING NEW TECHNOLOGIES, https://doi.org/10.47612/978-985-880-283-7-2022-310-324.",
                "Choquette, K. D. “Technology Status and Opportunities of VCSELs.” 2003, 295–97. https://doi.org/10.1109/iciprm.2002.1014379.",
                "[1]Monchik EP. MAIN ACTIVITIES OF THE REPUBLICAN LIBRARY FOR SCIENCE AND TECHNOLOGY OF BELARUS AS A METHODOLOGICAL CENTER FOR SCIENTIFIC AND TECHNICAL LIBRARIES OF ENTERPRISES AND ORGANIZATIONS OF THE REPUBLIC OF BELARUS, УП «ИВЦ Минфина»; 2022. https://doi.org/10.47612/978-985-880-283-7-2022-158-166.",
                "[1]D. M. MARTINS, CONEXÕES INTERDISCIPLINARES. Arco Editores, 2022. doi: 10.48209/978-65-5417-045-1.",
            ]
        )

        self.assertEqual(predictions[0]["primary"]["style"], "apa7")
        self.assertEqual(predictions[1]["primary"]["style"], "harvard-ctr")
        self.assertEqual(predictions[2]["primary"]["style"], "mla9")
        self.assertEqual(predictions[3]["primary"]["style"], "chicago-notes-bib")
        self.assertEqual(predictions[4]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[5]["primary"]["style"], "ieee")

    def test_returns_supported_exact_decision_for_clean_supported_style(self) -> None:
        prediction = predict_style_batch(
            [
                "Alexandra A. Taylor. (2022). Obituary: John H. Litchfield. Chemical & Engineering News, 25–25. https://doi.org/10.47287/cen-10040-obits4",
            ]
        )[0]

        self.assertEqual(prediction["decision"], "supported_exact")
        self.assertEqual(prediction["exactStyle"], "apa7")
        self.assertEqual(prediction["family"], "author_date")
        self.assertFalse(prediction["abstain"])
        self.assertTrue(prediction["supportedExact"])
        self.assertIn("thresholdSetVersion", prediction)

    def test_routes_known_unsupported_exact_styles_without_forced_supported_commit(self) -> None:
        prediction = predict_style_batch(
            [
                "1. Smith JA, Doe AB. Clinical trial update. Journal of Practice. 2020;12(3):44-50.",
            ]
        )[0]

        self.assertEqual(prediction["decision"], "known_unsupported_exact")
        self.assertEqual(prediction["knownUnsupportedExact"], "ama")
        self.assertEqual(prediction["family"], "numeric")
        self.assertTrue(prediction["abstain"])
        self.assertFalse(prediction["supportedExact"])

    def test_marks_non_citation_like_input_explicitly(self) -> None:
        prediction = predict_style_batch(["A guide"])[0]

        self.assertEqual(prediction["decision"], "not_citation_like")
        self.assertIsNone(prediction["exactStyle"])
        self.assertEqual(prediction["family"], "unknown")
        self.assertTrue(prediction["abstain"])
        self.assertIn("INPUT_NOT_CITATION_LIKE", prediction["reasonCodes"])

    def test_keeps_sparse_truncated_web_text_unknown(self) -> None:
        prediction = predict_style_batch(
            [
                "41. Intelligent clinical trials . (2020). https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-....",
            ]
        )[0]

        self.assertEqual(prediction["primary"]["style"], "unknown")

    def test_predicts_stage2b_bootstrap_blocker_patterns(self) -> None:
        predictions = predict_style_batch(
            [
                "Elgaafary, S., Hlevnjak, M., Schulze, M., Thewes, V., Seitz, J., Fremd, C., Michel, L., Beck, K., Pfütze, K., Richter, D., Wolf, S., Pixberg, C., Hutter, B., Ishaque, N., Hirsch, S., Gieldon, L., Stenzinger, A., Springfeld, C., Kreutzfeld, S., … Schneeweiss, A. (2020). Dauerhaftes Ansprechen auf Olaparib und endokrine Therapie bei einer Patientin mit metastasiertem luminalem Mammakarzinom und gBRCA-Mutation. Geburtshilfe und Frauenheilkunde. https://doi.org/10.1055/s-0040-1714539",
                "Cubeta, Germana. Dickens and the Italians in “Pictures from Italy.” Springer International Publishing, 2020. https://doi.org/10.1007/978-3-030-47429-4.",
                "Cubeta, Germana. Dickens and the Italians in “Pictures from Italy.” Springer International Publishing, 2020, https://doi.org/10.1007/978-3-030-47429-4.",
                "[1]Singh B, Singh G, Lee A. Five-Year Carotid Artery Intervention Outcomes, Thieme Medical and Scientific Publishers Pvt. Ltd.; 2023. https://doi.org/10.1055/s-0043-1763383.",
                "[1]US Geological Survey, “The minerals of North Carolina,” US Geological Survey, 1891. doi: 10.3133/b74.",
            ]
        )

        self.assertEqual(predictions[0]["primary"]["style"], "apa7")
        self.assertEqual(predictions[1]["primary"]["style"], "chicago-notes-bib")
        self.assertEqual(predictions[2]["primary"]["style"], "mla9")
        self.assertEqual(predictions[3]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[4]["primary"]["style"], "ieee")

    def test_predicts_latest_real_benchmark_style_blockers(self) -> None:
        predictions = predict_style_batch(
            [
                "[1]MARTINS DM. CONEXÕES INTERDISCIPLINARES. Arco Editores; 2022. https://doi.org/10.48209/978-65-5417-045-1.",
                "Кузьмичёва, Ю. А. (2025). Особенности применения приёмов интерактивной игры в работе с детьми дошкольного и младшего школьного возраста на экскурсиях. Матэрыялы навукова-практычнай канферэнцыі. https://doi.org/10.52275/pm2023-53-57",
                "Gomes Oliveira, Celina. “A Genese Da CUT.” Dissertation, Universidade Estadual de Campinas, 2021. https://doi.org/10.47749/t/unicamp.1995.111309.",
                "Ali, Nafhesa. Older South Asian Migrant Women’s Experiences of Ageing in the UK. Springer International Publishing, 2024, https://doi.org/10.1007/978-3-031-50462-4.",
                "[1]謝劍平謝劍平, 當代金融市場. 智勝出版, 2022. doi: 10.53106/9789575118433.",
                "[1]“Export of UDP Options Information in IP Flow Information Export (IPFIX),” RFC Editor. [Online]. Available: https://www.rfc-editor.org/rfc/rfc9870.html",
                "[1]Carral L, Rodriguez-Guerreiro MJ, Lamas Galdo I, Santiago Caamaño L, Camba Fabal C, Tarrio Saavedra J, et al. Design, Manufacture, Transportation and Installation of “Green Artificial Reefs” in the Galician Estuaries: An Opportunity for a Circular Economy and Sustainable Development. Springer Series on Naval Architecture, Marine Engineering, Shipbuilding and Shipping, Springer Nature Switzerland; 2024, p. 261–72. https://doi.org/10.1007/978-3-031-49799-5_39.",
                "Hassan, A., et al. “An Effective Technique for Solving Generalized Cahn-Hilliard (C-H) Problems.” Research Square Platform LLC, 2023, https://doi.org/10.21203/rs.3.rs-2870128/v1.",
            ]
        )

        self.assertEqual(predictions[0]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[1]["primary"]["style"], "apa7")
        self.assertEqual(predictions[2]["primary"]["style"], "chicago-notes-bib")
        self.assertEqual(predictions[3]["primary"]["style"], "mla9")
        self.assertEqual(predictions[4]["primary"]["style"], "ieee")
        self.assertEqual(predictions[5]["primary"]["style"], "ieee")
        self.assertEqual(predictions[6]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[7]["primary"]["style"], "mla9")

    def test_predicts_stage2a_blocker_citations_with_local_bootstrap_features(self) -> None:
        predictions = predict_style_batch(
            [
                "[1]International Monetary Fund. International Monetary Fund Annual Report 1986. International Monetary Fund; 1986. https://doi.org/10.5089/9781616351984.011.",
                "[1]謝劍平謝劍平. 當代金融市場. 智勝出版; 2022. https://doi.org/10.53106/9789575118433.",
                "[1]Awang NA, Mahmud NNHEBN, Zulkefli NUHH. Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber 2023. https://doi.org/10.2139/ssrn.4577205.",
                "Eberhard, W. (1896). Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427. De Gruyter. https://doi.org/10.1515/9783112466384",
                "Orós, Jorge. “Gout.” Mader’s Reptile and Amphibian Medicine and Surgery, Elsevier, 2019, pp. 1308-1309.e1, https://doi.org/10.1016/b978-0-323-48253-0.00151-3.",
                "Web page ranking for page query across public and private. Patent US20060235842A1, issued 2006. https://patents.google.com/patent/US20060235842A1/en.",
                "“Dendrobii officmalis caulis plants with heat preservation device in winter” (2026). Available at: https://patents.google.com/patent/CN223943381U/en.",
                "[1]Carral L, Rodriguez-Guerreiro MJ, Lamas Galdo I, Santiago Caamaño L, Camba Fabal C, Tarrio Saavedra J, et al. Design, Manufacture, Transportation and Installation of “Green Artificial Reefs” in the Galician Estuaries: An Opportunity for a Circular Economy and Sustainable Development. Springer Series on Naval Architecture, Marine Engineering, Shipbuilding and Shipping, Springer Nature Switzerland; 2024, p. 261–72. https://doi.org/10.1007/978-3-031-49799-5_39.",
                "[1]Botter Junior W. Relações interfaciais de poli(dimetilsiloxano) com solidos inorganicos. Dissertation. Universidade Estadual de Campinas, 2021. https://doi.org/10.47749/t/unicamp.1997.133750.",
            ]
        )

        self.assertEqual(predictions[0]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[1]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[2]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[3]["primary"]["style"], "apa7")
        self.assertEqual(predictions[4]["primary"]["style"], "mla9")
        self.assertEqual(predictions[5]["primary"]["style"], "chicago-notes-bib")
        self.assertEqual(predictions[6]["primary"]["style"], "harvard-ctr")
        self.assertEqual(predictions[7]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[8]["primary"]["style"], "vancouver")

    def test_predicts_current_unknown_collapse_and_pairwise_blockers(self) -> None:
        predictions = predict_style_batch(
            [
                "International Monetary Fund. (1986). International Monetary Fund Annual Report 1986. International Monetary Fund. https://doi.org/10.5089/9781616351984.011",
                "謝劍平謝劍平. (2022). 當代金融市場. 智勝出版. https://doi.org/10.53106/9789575118433",
                "Nurrohman, Eko. “Marjan Advertising Analysis 2023 From The Perspective of Jean Baudrillard.” Center for Open Science, 2023, https://doi.org/10.31219/osf.io/zf69h.",
                "Botter Junior, Wilson. Relações Interfaciais de Poli(Dimetilsiloxano) Com Solidos Inorganicos. 2021, https://doi.org/10.47749/t/unicamp.1997.133750. Universidade Estadual de Campinas, Dissertation.",
                "RFC Editor. “Export of UDP Options Information in IP Flow Information Export (IPFIX).” 2025. https://www.rfc-editor.org/rfc/rfc9870.html.",
                "Internet Engineering Task Force. “The Transport Layer Security (TLS) Protocol Version 1.3.” RFC Editor, Internet Engineering Task Force, 2018. https://www.rfc-editor.org/rfc/rfc8446.",
                "[1]Максимова ОВ, Чобитько ВГ, Мясникова АС. НАРУШЕНИЯ УГЛЕВОДНОГО ОБМЕНА У ЛИЦ С МЕТАБОЛИЧЕСКИМ СИНДРОМОМ, ФГБУ «НМИЦ эндокринологии» Минздрава России; 2023. https://doi.org/10.14341/cong23-26.05.23-78.",
                "[1]Kalyan birinderjit, Singh B. Fault-Tolerant Quantum-Dot Cellular Automata (Qca) Based Linear Feedback Shift Register (Lfsr) for Nano Communication Applications 2023. https://doi.org/10.2139/ssrn.4525741.",
                "[1]Majid H, Arshad H, Rehman S, Abidin Z ul, Siddiqi HS, Fatima S, et al. “A SWOC Analysis of Online Undergraduate Medical Education and its Impact on Cognitive Outcomes: Cross-Sectional Study” (Preprint) 2023. https://doi.org/10.2196/preprints.47303.",
                "“A waste storage pool for thermal power plants” (2026). Available at: https://patents.google.com/patent/CN223935505U/en.",
            ]
        )

        self.assertEqual(predictions[0]["primary"]["style"], "apa7")
        self.assertEqual(predictions[1]["primary"]["style"], "apa7")
        self.assertEqual(predictions[2]["primary"]["style"], "mla9")
        self.assertEqual(predictions[3]["primary"]["style"], "mla9")
        self.assertEqual(predictions[4]["primary"]["style"], "chicago-notes-bib")
        self.assertEqual(predictions[5]["primary"]["style"], "chicago-notes-bib")
        self.assertEqual(predictions[6]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[7]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[8]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[9]["primary"]["style"], "harvard-ctr")

    def test_predicts_current_sparse_pages_patent_and_rfc_blockers(self) -> None:
        predictions = predict_style_batch(
            [
                "Alexandra A. Taylor. “Obituary: John H. Litchfield.” Chemical & Engineering News, 2022, 25–25. https://doi.org/10.47287/cen-10040-obits4.",
                "Richard, Jacques, Vivien Enjolras, Laurent Rys, Juliette Vallon, Isabelle Nann, and Philippe Escudier. “Space Altimetry from Nano-Satellites : Payload Feasibility, Missions and System Performances.” 2008, III-71-III–74. https://doi.org/10.1109/igarss.2008.4779285.",
                "[1]Export of UDP Options Information in IP Flow Information Export (IPFIX). RFC Editor 2025. https://www.rfc-editor.org/rfc/rfc9870.html.",
                "Web page ranking for page query across public and private (Patent No. US20060235842A1). (2006). https://patents.google.com/patent/US20060235842A1/en",
                "Albers, Ulrike. Evolution and Treatment of Vitamin B12 Deficiency as a Risk Factor for (Cognitive and Functional) Neurodegenerative Diseases in Institutionalized Elderly = Evolución y Tratamiento de La Deficiencia de Vitamina B12 Como Factor de Riesgo de Enfermedades Neurodegenerativas (Cognitivas y Funcionales) En Las Personas Mayores Institucionalizadas. 2022, https://doi.org/10.20868/upm.thesis.14629. Universidad Politecnica de Madrid - University Library, Dissertation.",
                "Fusarium Venenatum Strain with High Substrate Conversion Rate and Low RNA Content and Application Thereof. no. CN121555333A, 2026, https://patents.google.com/patent/CN121555333A/en.",
            ]
        )

        self.assertEqual(predictions[0]["primary"]["style"], "chicago-notes-bib")
        self.assertEqual(predictions[1]["primary"]["style"], "chicago-notes-bib")
        self.assertEqual(predictions[2]["primary"]["style"], "vancouver")
        self.assertEqual(predictions[3]["primary"]["style"], "apa7")
        self.assertEqual(predictions[4]["primary"]["style"], "mla9")
        self.assertEqual(predictions[5]["primary"]["style"], "mla9")

    def test_primary_mode_without_calibration_forces_conservative_abstain(self) -> None:
        bundle = load_style_bundle()
        base_policy = load_style_decision_policy()
        policy = StyleDecisionPolicyBundle(
            threshold_set_version=base_policy.threshold_set_version,
            supported_exact_styles=base_policy.supported_exact_styles,
            known_unsupported_exact_styles=base_policy.known_unsupported_exact_styles,
            family_by_style=base_policy.family_by_style,
            operating_mode="primary",
            require_calibration_for_primary=True,
            calibration_available=False,
            abstain_on_missing_primary_calibration=True,
            thresholds=base_policy.thresholds,
            profile_thresholds=base_policy.profile_thresholds,
            reason_codes=base_policy.reason_codes,
            source=base_policy.source,
        )
        prediction = predict_style(
            "Alexandra A. Taylor. (2022). Obituary: John H. Litchfield. Chemical & Engineering News, 25–25. https://doi.org/10.47287/cen-10040-obits4",
            bundle=bundle,
            policy_bundle=policy,
        )

        self.assertTrue(prediction["abstain"])
        self.assertEqual(prediction["decision"], "unknown_or_ood")
        self.assertIn("MISSING_CALIBRATION_PRIMARY", prediction["reasonCodes"])


if __name__ == "__main__":
    unittest.main()
